---
title: "Comparing Idiomatic Spaceships in Ruby"
---

If you want to make a Ruby class comparable (ex. `a > b`), all you have to do is
implement the "spaceship" method, `<=>`, and `include` the [`Comparable`][]
module. But how _do_ you implement the spaceship?

[`Comparable`]: https://docs.ruby-lang.org/en/master/Comparable.html

If your class is simple, maybe a Die with 6 faces, you could just delegate to an
attribute, like the Die's value[^1].

```ruby
class Die
  attr_reader :value

  def <=>(other)
    self.value <=> other.value
  end
end
```

But what if the class is more complicated, like a Die that could have any number
of faces: how do we write the spaceship if we want to prefer higher values _and_
more faces?

## A Common Suggestion

What I've seen suggested most often (ex. [stackoverflow][]) is to use
`Array#<=>`.

[stackoverflow]: https://stackoverflow.com/questions/8123676/ruby-using-comparable-mixin-to-compare-objects-on-two-different-attributes

```ruby
class Die
  attr_reader :faces, :value

  def <=>(other)
    [self.value, self.faces] <=> [other.value, other.faces]
  end
end
```

This works well, and its quite concise! However, it does have some downsides...

One downside is that the values in the array are eagerly computed. In the `Die`
example this isn't a problem because `value` and `faces` are attributes, but
what if the comparison isn't as straightforward?

```ruby
class Die
  attr_reader :value, :color

  def <=>(other)
    [self.value, color_priority] <=> [self.value, other.color_priority]
  end

  protected

  PRIMARY_COLORS = ["red", "blue", "yellow"]

  def color_priority
    if PRIMARY_COLORS.include? color
      1
    else
      0
    end
  end
end
```

This isn't _bad_, but it may perform more work than necessary. If the `value`s
of the `Die` are different, then the time spent calculating the
`color_priority`s is wasted because they'll never be used.

Additionally, if comparison is a hotspot, then using `Array#<=>` isn't great
because it allocates _two arrays_ for each comparison. Bundler used to implement
a spaceship like this, and I measured that these arrays were 60% of all
allocations while running `bundle update <gem>` in one of my Rails applications.

I submitted a PR[^2] to remove the allocations by rewriting the spaceship to not
use arrays:

```ruby
class Bundler::Resolver::Candidate
  def <=>(other)
    version_cmp = version <=> other.version
    return version_cmp unless version_cmp.zero?

    priority <=> other.priority
  end
end
```

And while this solved the allocation issue, the spaceship unfortunately lost
some of its simplicity.

## The Number of Idiomatic Spaceships is `nonzero?`

After my Bundler PR was merged, [nobu][] helpfully shared an even better
approach: the idiomatic spaceship.

```ruby
class Bundler::Resolver::Candidate
  def <=>(other)
    (version <=> other.version).nonzero? || priority <=> other.priority
  end
end
```

[nobu]: https://github.com/nobu

This version uses `Numeric#nonzero?`, which was actually [implemented][] for
exactly this purpose!

[implemented]: https://bugs.ruby-lang.org/issues/9123#note-14

What's interesting about `nonzero?` is that instead of returning `true` or
`false`, it returns `self` or `nil`. This distinction is the special sauce
that makes the idiomatic spaceship work.

The first time I tried to remove the array allocations from `Candidate`'s
spaceship, I tried this

```ruby
class Bundler::Resolver::Candidate
  def <=>(other)
    version <=> other.version || priority <=> other.priority
  end
end
```

The problem is that this doesn't actually work when the versions are equal,
because the first `<=>` returns `0`, which is truthy in Ruby (meaning `0 ||
anything` is `0`). `nonzero?` solves this by turning `0` (and only `0`) into
`nil` (a falsy value).

In addition to making spaceships concise and allocation free, `nonzero?` also
enables lazily evaluating even the most complex spaceships.

Just this week I found a spaceship in a Rails application that looked like this

```ruby
class ClassWithManyFields
  def <=>(other)
    cmps = [
      method(:compare_field_one),
      method(:compare_field_two),
      method(:compare_field_three),
      method(:compare_field_four),
      method(:compare_field_five),
    ]

    cmps.each do |cmp|
      cmp_value = cmp.call(other)
      return cmp_value unless cmp_value == 0
    end

    0
  end
end
```

Each `compare` function was individually complex, so it makes sense that the
author didn't want to eagerly evaluate them. The `each` loop also seems like a
very reasonable way to avoid writing four different early `return`s.

However, the idiomatic spaceship can make even this complex method concise.

```ruby
class ClassWIthManyFields
  def <=>(other)
    compare_field_one(other).nonzero? ||
      compare_field_two(other).nonzero? ||
      compare_field_three(other).nonzero? ||
      compare_field_four(other).nonzero? ||
      compare_field_five(other)
  end
end
```

With all of these positive qualities, I'm really surprised that using `nonzero?`
isn't more common; it certainly seems like the best way to write spaceship
methods. I want to thank [nobu][] for sharing this approach as I will definitely
be using it more often going forward. Hopefully you will too!

---

[^1]: Spaceships often include a `self.class === other` check as well, but I'm
    leaving it out of this post for simplicity.

[^2]: The [PR](https://github.com/rubygems/rubygems/pull/8559) was released in
    Bundler 2.6.6, and some [even better optimizations][] were released in
    Bundler 2.6.7. Make sure you update for faster `bundle update`s!

[even better optimizations]: https://github.com/rubygems/rubygems/pull/8589
