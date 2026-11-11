---
title: 'Ractor-age Rails: A How-To Guide'
canonical_url: https://railsatscale.com/2026-09-16-ractor-age-rails-a-how-to-guide/
author: Hartley McGuire
published: true
excerpt: 'Patterns, Pitfalls, and Pull Requests'
# Add custom words for spell checker to ignore on the line below
# cspell:words Edouard Ractors
---

*Originally published on [Rails At Scale]({{ page.canonical_url }})*

In our [last post][] on Ractors, [Edouard][] demonstrated the potential benefits
of using Ractors in a Rails application. He also explained how our team has been
working towards making Rails and its dependencies Ractor-friendly. While we've
been able to get smaller applications running on Ractors, we still have a long
way to go to unlock larger applications, which use more features of Rails and
many more gems. However, we _have_ reached a good point where we can start to
talk about the process itself.

In this post, I want to discuss some of the patterns we've used to refactor code
to work with Ractors. But first, let's talk about why any of this is necessary
by looking at the constraints that Ractors impose, and why those constraints
even exist.

[last post]: https://railsatscale.com/2026-08-11-ractors-on-rails/
[Edouard]: https://railsatscale.com/authors/edouard-chin/

## Fearless Concurrency Comes at a Cost

Let's start by talking about "what's wrong" with one of today's common
concurrency primitives, Threads. Threads provide an illusion of parallelism by
interleaving their execution, but every thread shares CRuby's Global VM Lock
(GVL), so only one Thread can ever execute Ruby code at a time. If the GVL could
be removed, then every Thread could execute in parallel, but that would also
expose anything shared between Threads to data races. What we'd really like is
something that removes the GVL, but _also_ prevents those data races.

That's exactly what Ractors do.

Each Ractor has its own GVL, which allows them to execute Ruby code in parallel.
They also prevent data races by disallowing mutable state from being shared
between Ractors.

Of course, it's that second bit that necessitates making changes to existing
code. Let's look at some examples to see what that means:

```ruby
module Rails
  VERSION = [8, 2, 0].join(".")
end
```

Here's a simplified implementation of `Rails::VERSION`. Can we use it in a
Ractor?

```ruby
Ractor.new { Rails::VERSION }.value
# can not access non-shareable objects in constant Rails::VERSION of a class/module created by another Ractor. (Ractor::IsolationError)
```

Nope![^1] To use Strings created in other Ractors, they have to be _shareable_:

```ruby
module Rails
  VERSION = [8, 2, 0].join(".").freeze
end

Ractor.new { Rails::VERSION }.value
# => "8.2.0"
```

And this "shareable" requirement applies to almost everything you could want to
use across Ractors. For simple objects like `String`, `Array`, and `Hash`,
"shareable" just means the objects need to be deeply frozen. You can either
`freeze` values individually, or you can use [`Ractor.make_shareable`][] to deep
freeze an entire object graph.

[`Ractor.make_shareable`]: https://docs.ruby-lang.org/en/4.0/Ractor.html#method-c-make_shareable

```ruby
# frozen_string_literal: true

A = { msgs: ["This won't work"] }.freeze

Ractor.new { A[:msgs].first }.value
# can not access non-shareable objects in constant Object::A of a class/module created by another Ractor. (Ractor::IsolationError)

B = { msgs: ["But this will!"].freeze }.freeze

Ractor.new { B[:msgs].first }.value
# => "But this will!"

C = Ractor.make_shareable({ msgs: ["This will also work!"] })

Ractor.new { C[:msgs].first }.value
# => "This will also work!"
```

> 💡 Tip
>
> You can use RuboCop's [Style/MutableConstant][] cop to help enforce
> this.[^2] We also added a new [Recursive][] mode which ensures constants
> aren't just frozen shallowly.

[Style/MutableConstant]: https://docs.rubocop.org/rubocop/latest/cops_style.html#stylemutableconstant
[Recursive]: https://github.com/rubocop/rubocop/pull/15166

Okay, so just deep freeze everything and we should be good, right?
Unfortunately, it's not quite that simple.

## Stop Being so Lazy!

We've previously written about how the [memoization pattern][] can affect
performance by increasing the number of Object Shapes a class will have. The
memoization pattern can _also_ be a problem for Ractors, since Ractors need
shared objects to be immutable and instance variables can't be set on frozen
objects.

[memoization pattern]: https://railsatscale.com/2023-10-24-memoization-pattern-and-object-shapes

We've solved these kinds of issues a few different ways.

### Remove the Memoization

The first is to re-evaluate the use of memoization. Does the value's computation
really require caching? Perhaps it was justified when originally written, but
maybe it's fast enough today to run on demand and the memoization can be
removed.

For example, Active Record used to memoize whether a model had overridden
`default_scope`. We [removed this memoization][] and now perform the check each
time instead:

[removed this memoization]: https://github.com/rails/rails/pull/57642

```ruby
# Before
if default_scope_override.nil?
  self.default_scope_override = !Base.is_a?(method(:default_scope).owner)
end

if default_scope_override
  # ...
end

# After
if !Base.is_a?(method(:default_scope).owner)
  # ...
end
```

### Compute on `freeze`

If the computation really needs to only happen once, another option is to
perform it on `freeze`. By defining a `freeze` method, we can hook into the
exact moment where the object will be frozen and perform the computation at the
last possible moment.

For example, `ActiveSupport::TaggedLogging::Formatter` lazily computes a key the
first time its tag stack is accessed:

```ruby
def tag_stack
  @thread_key ||= "activesupport_tagged_logging_tags:#{object_id}"
  IsolatedExecutionState[@thread_key] ||= TagStack.new
end
```

If the formatter were frozen before `tag_stack` was called, setting
`@thread_key` would raise a `FrozenError`. We [added a `freeze` hook][] which
forces the key to be computed first:

[added a `freeze` hook]: https://github.com/rails/rails/pull/57644

```ruby
def freeze
  tag_stack
  super
end
```

### Compute Eagerly

The last option I'll mention is performing the computation eagerly. This is
similar to hooking into `freeze`, but we'll "hook" into `initialize` instead.
This option tends to be best for immutable values that won't change over the
object's lifetime and, as mentioned, can result in fewer object shapes as well.

For example, `ActiveSupport::Cache::Strategy::LocalCache` used to lazily memoize
its `local_cache_key`. Since the key never changes for the lifetime of a
`Cache`, we [moved the computation][] to `initialize`:

[moved the computation]: https://github.com/rails/rails/pull/58061

```ruby
# Before
def local_cache_key
  @local_cache_key ||=
    "#{self.class.name.underscore}_local_cache_#{object_id}".gsub(/[\/-]/, "_").to_sym
end

# After
def initialize(...)
  super
  @local_cache_key =
    "#{self.class.name.underscore}_local_cache_#{object_id}".gsub(/[\/-]/, "_").to_sym
end

attr_reader :local_cache_key
```

## Immutable, but also Configurable?

For values which never change, deep freezing is quick and easy. However, Rails
allows many things to be configured during boot, so we can't just freeze
everything.

One of the patterns we used for making configurable values Ractor-compatible is
**Read-Copy-Update (RCU)**. For example, let's look at [how we changed][]
[`attr_readonly`][]:

[how we changed]: https://github.com/rails/rails/pull/57682
[`attr_readonly`]: https://api.rubyonrails.org/v8.1/classes/ActiveRecord/ReadonlyAttributes/ClassMethods.html#method-i-attr_readonly

```ruby
# Before
def attr_readonly(*attributes)
  self._attr_readonly |= attributes.map(&:to_s)
end

# After
def attr_readonly(*attributes)
  self._attr_readonly = Ractor.make_shareable(self._attr_readonly | attributes.map(&:to_s))
end
```

Before, `_attr_readonly` was a mutable array, and new attributes are just added
to it. To make it Ractor compatible, it must be frozen, so now it:

- **reads** the old array
- creates a **copy** that adds the new attributes
- deeply freezes it with `make_shareable`
- and finally **updates** the variable to point to the new value

This pattern works well because `_attr_readonly` is an internal/private API, so
we can make it frozen without worrying about breaking applications. For public
APIs, we have to be more careful.

Both Rails and some of its dependencies have values which are documented as
being mutable. We can't freeze these values by default, or even use
Read-Copy-Update internally, as that would break the compatibility guarantee.

For these, we typically have to deprecate the existing API in favor of a new
one. But this also comes with another challenge: how can we make progress
towards Ractor compatibility while still supporting the existing API?

For these cases, we have to get creative.

One example of this creativity is how we changed [`Rack::MethodOverride`][].
This is the Rack middleware that enables forms to submit `PUT` requests by
including a hidden `_method` field. It has two constants, `HTTP_METHODS` and
`ALLOWED_METHODS`, which are both currently public and unfrozen.

[`Rack::MethodOverride`]: https://github.com/rack/rack/commit/f1a240d07f0a2a9cca6a78ba4d315420d40983e7

To make the middleware compatible with Ractors, we introduced a new API:
`initialize` will now accept `http_methods` and `allowed_methods` keywords which
default to the current constants, and store the values as instance variables.
This solves both the immediate Ractor compatibility issue as well as the
backwards compatibility issue:

- if an application is currently mutating the constants, it can continue to do
  so (but will get a deprecation warning)
- if an application wants to be Ractor compatible, it can use
  `Ractor.make_shareable` to deep freeze the middleware and the constants will
  be frozen since they are stored as instance variables![^3]

## Just Try to be Shareable

So far, we've mostly looked at values that Rails controls. However, many Rails
APIs accept objects from applications, and Rails frequently stores those objects
inside its own object graph. Callbacks are a particularly common example:

```ruby
# frozen_string_literal: true

class Post < ActiveRecord::Base
  prefix = +"Draft: "
  before_create { title.prepend(prefix) }
end
```

The user provided object here is the block passed to `before_create`. Since
Rails can't guarantee that blocks like this can be made shareable with
`Ractor.shareable_proc`, we [introduced][] an internal helper which can be
configured to `warn` or `raise` if the block can't be made shareable:

[introduced]: https://github.com/rails/rails/pull/57626

```ruby
# frozen_string_literal: true

class Post < ActiveRecord::Base
  prefix = +"Draft: "
  before_create { title.prepend(prefix) }
  # Logs:
  #
  # DEPRECATION WARNING: Rails attempted to make a Proc from your application Ractor shareable but a Ractor
  # Isolation error was raised. The proc being returned is not Ractor safe and a runtime
  # error may occur anytime during the request lifecycle.
  #
  # #<Proc:0x0000000128ff3ad8 app/models/post.rb:3>
  #  (called from <class:Post> at app/models/post.rb:3)
end
```

This can be configured by setting
`ActiveSupport::Ractors.unshareable_proc_action`:

- `nil` doesn't attempt to make application objects shareable (same as today)
- `:warn` attempts to make them shareable, but emits a deprecation warning if it
  can't
- `:raise` attempts to make them shareable and raises the
  `Ractor::IsolationError` if it can't

> Note that the issue with `Post`'s callback above is that the block references
> `prefix`, which is a mutable String. Freezing the string or inlining the value
> would allow the block to successfully be made shareable.

## Meanwhile, Back on the Main Ractor

Finally, there's some stuff which is just... harder to fix. For example, Active
Record wants to cache the list of columns which `INSERT ... RETURNING`
statements will return. However, for some adapters this list depends on queried
database metadata which is only available after database connections are
established. Since booting a Rails application shouldn't depend on a database
connection being available, this work must be performed lazily. So, how do we do
it?

Well, we can't set class instance variables on _non-main_ Ractors, but we _can_
set them on the _main_ Ractor.

For these cases, we [added][] a wrapper around [John Hawthorn][]'s
[`ractor-dispatch`][] gem. As the name implies, it provides a simple API for
non-main Ractors to dispatch work to the main Ractor.

[added]: https://github.com/rails/rails/pull/57662
[John Hawthorn]: https://railsatscale.com/authors/john-hawthorn/
[`ractor-dispatch`]: https://github.com/jhawthorn/ractor-dispatch

```ruby
# Before
module ModelSchema
  def _returning_columns_for_insert(connection)
    @_returning_columns_for_insert ||= do_computation
  end
end

# After
module ModelSchema
  def _returning_columns_for_insert(connection)
    @_returning_columns_for_insert || ActiveSupport::Ractors.on_main(self) do
      @_returning_columns_for_insert ||= do_computation
    end
  end
end
```

The downside of dispatching work to the main Ractor is that we can lose the
parallelism benefits that Ractors provide. If every Ractor is waiting on the
main Ractor to do its work, then we've effectively re-introduced a single GVL.
However, as long as it's used sparingly, it can be a useful tool for making code
Ractor-safe without having to do significant refactors. In our case, we only
used it for a few memoized values, so the performance impact is negligible.

## So, are we Ractor Yet?

As Edouard concluded in his post, this is only the beginning of the journey
towards Ractor-age Rails. We've been able to run small applications on Ractors
to demonstrate the performance benefits, and we've established a series of
patterns for making code Ractor-safe that has worked well for us so far. We also
know there's some patterns which we still need to figure out, like using some
sort of Ractor safe equivalent to `concurrent-ruby`, which currently only
provides Thread safety.

However, we still have a long way to go. Big applications have more lines of
code, more dependencies, and use more features of Rails which all need to be
Ractor-safe. Luckily, we have a few more tricks up our sleeve for making
progress... you should come learn about them at [Rails World][]!

[Rails World]: https://rubyonrails.org/world/2026/sessions/ractors-rails-robots

---

[^1]: This is [now] fixed on `main`.

[now]: https://github.com/rails/rails/pull/58695

[^2]: We [enabled][] this in `rails/rails`'s RuboCop configuration.

[enabled]: https://github.com/rails/rails/pull/57323

[^3]: For Rails, all middleware will be recursively frozen because the
    middleware stack is an instance variable on `Rails.application`, so
    `Ractor.make_shareable` will deep freeze all of the middleware in the stack.
