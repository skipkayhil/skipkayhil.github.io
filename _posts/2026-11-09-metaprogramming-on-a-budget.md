---
title: Metaprogramming on a Budget
canonical_url: https://railsatscale.com/2026-11-09-metaprogramming-on-a-budget/
author: Hartley McGuire
published: true
excerpt: How ✨<i>Rails Magic</i>✨ uses advanced techniques to save you memory
# Add custom words for spell checker to ignore on the line below
# cspell:words objspace klasses sheap Sheap imemo iseq IMEMO metaprogrammed pathobj
---

*Originally published on [Rails At Scale]({{ page.canonical_url }})*

If you generate an empty model class in a Rails application, the attribute
methods are automatically available:

```ruby
class Post < ActiveRecord::Base
end

p = Post.new
p.title = "Metaprogramming on a Budget"
p.title # => "Metaprogramming on a Budget"
```

It's one of Rails' oldest features, as seen in the old [Build a Blog in 15
Minutes][] demo from 2005. But how does it work? 

## ✨ Metaprogramming ✨

[Build a Blog in 15 Minutes]: https://www.youtube.com/watch?v=Gzj723LkRJY

If you've never used it before, metaprogramming may sound really scary, but its
not too bad in practice. All it really means is that we're writing code that
writes more code.

To get a better understanding, let's try implementing a simple version of this
Rails feature ourselves. The entrypoint will be a class method named
`define_attribute_methods`, which Rails defines in
`ActiveModel::AttributeMethods`.

```ruby
module MetaClassMethods
  def define_attribute_methods(*attribute_names)
    # TODO
  end
end
```

> You may notice that the `define_attribute_methods` method on Active Record
> models doesn't accept any parameters. Active Record overrides Active Model's
> implementation to automatically get the list of attribute names from the
> database schema.

We can try using our new method, but of course it doesn't do anything yet:

```ruby
class Post
  extend MetaClassMethods

  define_attribute_methods :title
end

p = Post.new
p.title # NoMethodError
```

Now let's make it do something. 

The goal is to iterate over the list of attribute names and define getter and
setter methods for each one. Things start to get interesting here because we
can't use `def`. Since `def` is a keyword, and not a method, it can only be used
to define methods where the method name is known at parse time. We want to
define methods where the name is only known at runtime, so we'll need something
else.

For these situations, Rails typically uses [`Module#class_eval`][]. It accepts a
string of Ruby code which will be evaluated in the context of the class, so we
can use string templating to define our attribute methods dynamically:

[`Module#class_eval`]: https://docs.ruby-lang.org/en/4.0/Module.html#method-i-class_eval

```ruby
module MetaClassMethods
  def define_attribute_methods(*attribute_names)
    attribute_names.each do |attribute_name|
      class_eval <<-RUBY, __FILE__, __LINE__ + 1
        def #{attribute_name}         # def title
          @#{attribute_name}          #   @title
        end                           # end

        def #{attribute_name}=(value) # def title=(value)
          @#{attribute_name} = value  #   @title = value
        end                           # end
      RUBY
    end
  end
end
```

I included code comments on the right so that its easier to see what each
templated line will produce. These aren't required, but they can be useful to
help remind future readers what the generated code is supposed to look like. The
`__FILE__` and `__LINE__` bits are also optional, but good practice to include
because they make finding the method source easier when debugging.

Now if we try using our `Post` class again, it should work as expected:

```ruby
class Post
  extend MetaClassMethods

  define_attribute_methods :title
end

p = Post.new
p.title = "Metaprogramming on a Budget"
p.title # => "Metaprogramming on a Budget"
```

## But Does It Scale?

Let's talk about memory usage.

If an application has 1000 tables with 10 columns each, how much memory is used
by these attribute methods? We can use some fancy Ruby heap tools to find out:

```ruby
module MetaClassMethods
  # same as before
end

# Create the classes and column names before allocation tracking so that we only
# end up seeing the impact of the attribute methods
columns = 10.times.map { |i| :"column_#{i}" }
klasses = 1000.times.map do
  Class.new { extend MetaClassMethods }
end

# Do fancy heap tracking stuff to see how much memory the attribute methods use
require "objspace"
ObjectSpace.trace_object_allocations_start
mark = GC.stat(:count)

klasses.each do |klass|
  klass.define_attribute_methods(*columns)
end

GC.start
ObjectSpace.dump_all(output: File.open("heap.json", "w"), since: mark)

# There's a bunch of different heap analysis tools available, but for this
# example we'll use the `sheap` gem.
require "sheap"
Sheap::Heap.new("heap.json").objects
  .select { |o| o.type_str == "ARRAY" || o.imemo_type == "iseq" }
  .group_by { |o| o.imemo_type == "iseq" ? "IMEMO:iseq" : "ARRAY" }
  .transform_values { |os| { count: os.size, memsize: os.sum(&:memsize) } }
# => {"ARRAY" => {count: 20000, memsize: 800000}, "IMEMO:iseq" => {count: 20000, memsize: 10400000}}
```

It's okay if you don't understand everything going on above, I'm usually trying
to figure it out as I go too. The important thing to know is that each of these
attribute methods allocates an internal instruction sequence object
(`IMEMO:iseq`) and an internal array that the instruction sequence uses for
tracking the source of the code.[^1]

The script above uses [`Sheap`][] to filter `heap.json`, which includes every
object in the Ruby heap, down to just instruction sequences and arrays, so that
we can see how many there are and how much memory they use.

[`Sheap`]: https://github.com/jhawthorn/sheap

In total, the 20,000 attribute methods (10 columns * 1,000 classes * 2 methods)
consume ~10 MB. Is that a lot? Maybe not on its own, however, Active Record
actually generates 21 (!!!) attribute methods per column, so a more realistic
estimate would be closer to 100 MB. Now _that's_ worth optimizing.

## Your Columns Aren't Special

So how can we do better? Well, there's two key insights to make.

The first insight is that our method generation is "pure"[^2]. A pure function
is one which always produces the same output given the same input, and also has
no side effects. Every time we generate a getter for a column named `title`, it
will always produce the same code for the `title` method

```ruby
def title
  @title
end
```

and the same is true for the setter, and every other generated attribute method.

The other insight is that most column names in Rails applications are not
unique. Think about some common ones: `id`, `created_at`, `updated_at`, maybe a
sharding column like `shop_id`, and even association foreign keys. In our
largest application, only about *a third* of the column names are unique. That
means if we can "de-duplicate" the generated methods, we could save up to *two
thirds* of the memory used by attribute methods.

Is that de-duplication something we can do? It turns out, yes!

The trick is to use [`Module#define_method`][]. I was previously only familiar
with the ability to pass a block to `define_method` for defining a method's
body, but it turns out you can also give it an existing `Method` or
`UnboundMethod`. When you do that, the newly defined method will share the
existing method's instruction sequence.

[`Module#define_method`]: https://docs.ruby-lang.org/en/4.0/Module.html#method-i-define_method

We'll implement this approach on a new `CodeGenerator` module, which will handle
this "method caching" logic. It defines all methods on a single `CACHE` module,
and then copies them onto the target class by passing the `UnboundMethod` object
to `define_method`.

```ruby
module CodeGenerator
  CACHE = Module.new

  class << self
    def define_cached_method(target, name, code, file, line)
      if !CACHE.method_defined? name
        CACHE.class_eval(code, file, line)
      end

      # Look ma, no block!
      target.define_method(name, CACHE.instance_method(name))
    end
  end
end
```

Now let's tweak `define_attribute_methods` a bit to use the `CodeGenerator`:

```ruby
module MetaClassMethods
  def define_attribute_methods(*attribute_names)
    attribute_names.each do |attribute_name|
      CodeGenerator.define_cached_method(self, attribute_name, <<-RUBY, __FILE__, __LINE__ + 1)
        def #{attribute_name}         # def title
          @#{attribute_name}          #   @title
        end                           # end
      RUBY

      CodeGenerator.define_cached_method(self, "#{attribute_name}=", <<-RUBY, __FILE__, __LINE__ + 1)
        def #{attribute_name}=(value) # def title=(value)
          @#{attribute_name} = value  #   @title = value
        end                           # end
      RUBY
    end
  end
end
```

It's slightly more complex than before: it now has to pass `self` (the thing to
define the final method on), and the method name to define.

And if we measure the memory usage again

```ruby
# => {"ARRAY" => {count: 20, memsize: 800}, "IMEMO:iseq" => {count: 20, memsize: 10400}}
```

we'll see only 20 instruction sequences/arrays allocated! Do note that this is a
_best_ case scenario where every table has the same 10 columns, so the memory
savings are more dramatic than they would be in a real application. However, the
more realistic change in memory usage from `O(tables * columns)` to `O(unique
columns)` can still make a pretty big impact.

## Why are you telling me all of this?

For starters, I find sneaky optimization techniques like this fascinating (and I
hope you do too). But more importantly, this technique continues to be a
valuable source of memory savings in our application and I'm surprised it's not
more widely used given its age.

The "method cache" idea was first introduced in Active Record back in 2013, but
only for [reader][] and [writer][] methods. It was later [removed][]
(accidentally?) in 2015 when support for Ruby 1.9 was dropped.

[reader]: https://github.com/rails/rails/commit/a2b847ae49e6a31bbfac8c9843cd0367b85d88db
[writer]: https://github.com/rails/rails/commit/55ac7db11bd2fc0cf06d7184f013018fa4be0e9a
[removed]: https://github.com/rails/rails/commit/b2bb2a462f8950522688e8e0d87a7d32a5863438

It was [re-introduced][] in 2021 for _all_ attribute methods, and then
[generalized][] so that it could also be used for `CurrentAttributes`, but that
was the full extent of its usage!

[re-introduced]: https://github.com/rails/rails/commit/ca5542fed3848961eba00935e5e107f366feabb7
[generalized]: https://github.com/rails/rails/commit/bf33510d86bb483b40fde3f104d2c60d2c195c7e

I've been thinking we may want to start caching methods for other metaprogrammed
features in Rails, like association methods, since they are one of the largest
single sources of memory usage in our application. Since we can fix everything
now, I went ahead and just [did that][]. As expected, that change is saving us
another huge chunk of memory.

[did that]: https://github.com/rails/rails/pull/59393

_Also_, while I've had this blog post in draft (for like a month 😔), [Aaron][]
has been working on an optimization which will make the memory savings for
caching attribute methods even more dramatic! I'll leave the details to a future
blog post (? 👀), but if you're curious you can checkout the [pull request][] in
the meantime.

[Aaron]: https://railsatscale.com/authors/aaron-patterson/
[pull request]: https://github.com/rails/rails/pull/59141

I hope you enjoyed this peek behind the curtain of Rails' metaprogramming magic!

---

[^1]: (Sorry, this gets a bit technical) The `ARRAY` is the `pathobj` on the
    instruction sequence, which contains two elements: `__FILE__` and `nil`. The
    `nil` is currently how Ruby knows the instruction sequence was `eval`d. One
    of my teammates, [Luke][], [optimized this][] so that Ruby 4.1 will store
    this information more efficiently and avoid allocating the array 🎉.

[^2]: This is specifically referring to the generation of the _Ruby code_.
    Running the generated code to define the method is _not_ pure, since it
    mutates a class' methods.

[Luke]: https://railsatscale.com/authors/luke-gruber/
[optimized this]: https://github.com/ruby/ruby/pull/19218
