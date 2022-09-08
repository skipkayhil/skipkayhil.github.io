---
title: "Wtf is an Active Support Duration?"
---

If you have been around Rails for even a short amount of time, you have
probably seen some code that looks something like

```ruby
1.day # => 1 day
2.days + 12.hours # => 2 days and 12 hours
```

and with a little more time, you may start wondering about

```ruby
require "active_support/core_ext/integer/time" # <= this require

Rails.application.configure do
  # ...
end
```

at the top of your `config/environments/*.rb` files.

How do these **magic** methods work? Why do environment files need this mystery
`require` ? And wtf is an Active Support Duration??

As you may have guessed already, this mysterious `require` in
`config/environments` is to ensure that applications are loading one of
[Active Support's Core Extensions][core_ext], and this core extension is what
enables the fancy `1.day` syntax. And if you inspect what these methods return,
you will find that they are instances of `ActiveSupport::Duration`.

To really understand _what_ `ActiveSupport::Duration` is and _why_ it exists,
it is important to first look back at how things worked before it was added.

[core_ext]: https://guides.rubyonrails.org/active_support_core_extensions.html

### Core Extension Origins

The `Fixnum` Core Extension was first added to Rails in commit [38e55ba][]
(although in January of 2005 Rails was not actually using git yet). The
relevant part of the patch looks something like

```ruby
# activesupport/lib/core_ext/fixnum_ext.rb
class Fixnum
  def minutes
    self * 60
  end
  alias :minute :minutes

  def hours
    self * 60.minutes
  end
  alias :hour :hours

  def days
    self * 24.hours
  end
  alias :day :days

  # ...
end
```

[38e55ba]: https://github.com/rails/rails/commit/38e55bac6197c937c2f1ef356ff3be234758a7c7

This file monkeypatches the `Fixnum` class by re-opening it and defining some
new instance methods. This allows developers to write code like `2.days +
4.hours` and they'll have the calculation done for them *magically*. The secret
is that `2.days` is simply returning the number of seconds in 2 days, so it can
easily be added to the number of seconds in 4 hours.

On their own, these methods are pretty simple, but things start to get
more complicated when these methods are used to interact with `Time`.

Four new methods are added to the `Fixnum` Core Extension in commit [14ed815][]:
`ago`, `until`, `since`, and `from_now`. These all build on the previous
methods (`days`, `hours`, `minutes`, etc.) by making it super easy to add or
subtract values from `Time`.

[14ed815]: https://github.com/rails/rails/commit/14ed815b1c0098f1f7132d0a5a7e22088849c30e

While these methods work well for smaller units like hours, days, or weeks, they
don't produce as accurate results for the larger units like months and years.

```ruby
User.find(:all, :conditions => ['birthday > ?', 50.years.ago])
```

This is one of the examples given in commit [bb6b14b][], which changed the
`years` method to use `365.25.days` instead of `365.days`. Leaving off leap
years led to `50.years.ago` being many _days_ off of its intuitive value. For
example, before this patch `50.years.ago` today (`2022-09-02`) would return
`1972-09-14` instead of `1972-09-02`. Unfortunately, missing leap days is just
one example of the inaccuracies of this approach. At this point, `1.month` is
still equal to `30.days`, which can easily lead to the same kind of
non-intuitive calculations.

[bb6b14b]: https://github.com/rails/rails/commit/bb6b14b04f9d3f1e8d8811588902eb7d61fb054e

The Core Extension methods were documented as being "approximations" with
alternative methods recommended for more precise Time and Date calculations.
However, this all changed with the introduction of `ActiveSupport::Duration`.

## Start of Duration

`ActiveSupport::Duration` was introduced in commit [276c9f2][] to address some
of the accuracy issues that come with converting everything to seconds. The
commit message doesn't have a ton of details but the [old Rails issue tracker][]
provides us with

> ## Make 1.month.from_now be accurate
>  The month, day, and year methods on Fixnum are not accurate, which is why
>  Time#advance was added. This patch creates a Duration class which makes these
>  methods use Time#advance for accurate date and time processing:
>
> ```ruby
> >> Time.now
> # => Tue Dec 12 23:59:38 PST 2006
> >> 1.month.from_now
> # => Fri Jan 12 23:59:46 PST 2007
> ```
>
> The current results:
>
> ```ruby
> >> Time.now
> # => Tue Dec 12 23:59:38 PST 2006
> >> 1.month.from_now
> # => Fri Jan 11 23:59:46 PST 2007
> ```
>
> The same applies for years and days. This patch also addresses the disconnect
> between adding to a Time and adding to a Date. See [#6803][] for the a description
> of the problem.
>
> I expect to go through at least a few updates of the patch, so feedback is
> appreciated! Tests are included.

[276c9f2]: https://github.com/rails/rails/commit/276c9f29cde80fafa23814b0039f67504255e0fd
[old Rails issue tracker]: https://web.archive.org/web/20090930071853/http://dev.rubyonrails.org/ticket/6835
[#6803]: https://web.archive.org/web/20090930071853/http://dev.rubyonrails.org/ticket/6803

If you thought `30.months.ago` was magical before, `ActiveSupport::Duration`
takes it up another notch. This `Duration` class uses a new approach for its
internal representation: instead of converting everything to seconds, **it
stores each unit of time separately**. As mentioned in the issue tracker
description, `Time#advance` allows a `Time` to be incremented by individual
units without any loss of precision

```ruby
Time.new(2022, 9, 2).advance(months: 30) # => 2025-03-02
```

By storing each unit of time separately, `Duration` is now able to use
`Time#advance` internally so that `30.months.ago` can return an accurate result!

## The End?

That's a short history of `1.day` and `ActiveSupport::Duration`. Hopefully this
helps to understand both how it works and the problems that its intended to
solve. There are a few more bits here that didn't quite get covered, but those
are topics for another day...
