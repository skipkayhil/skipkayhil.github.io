---
title: 'How I Think About Tests: Skips'
canonical_url: https://railsatscale.com/2026-06-08-how-i-think-about-tests-skips/
---

*Originally published on [Rails At Scale]({{ page.canonical_url }})*

If you've ever written a test for your code, you're probably familiar with
typical test framework methods: `test`/`it` to define test cases, and
`assert`/`expect` to make assertions about the behavior of your code.

However, I want to highlight a less commonly used method: in other languages or
frameworks it goes by other names, but in Ruby's `minitest` it's called `skip`.
In this post, I'll cover what `skip` does, when it may be useful, and, most
importantly, when you should probably use something else.

## Just `skip` to the good stuff

Okay, so what does `skip` do? Put simply, it allows you to _not_ run a test.

More concretely: in `minitest`, none of the test code after `skip` is run, an
`S` will be printed instead of the usual `.`/`F`/`E`, and you'll see it included
in the number of `skipped` tests in the summary:

```ruby
# test.rb
require "minitest/autorun"

class SkipTest < Minitest::Test
  def test_skip
    skip "This test is skipped."
    assert_equal 1, 2 # Notice that this assertion _would_ fail
  end

  def test_normal
    assert_equal 1, 1
  end
end
```

```shell
$ ruby test.rb
Run options: --seed 9367

# Running:

.S

Finished in 0.000576s, 3472.2225 runs/s, 1736.1112 assertions/s.

2 runs, 1 assertions, 0 failures, 0 errors, 1 skips

You have skipped tests. Run with --verbose for details.
```

So it's not _quite_ as simple as "just not running a test". `skip` also includes
some signals to make sure you know "hey, by the way, this test didn't actually
run".

## `skip`, don't run

The most common use of `skip` is to temporarily disable a test. Let's say you
have a newly failing test, and maybe it's caused by a dependency upgrade, or
maybe you're just in the middle of a really big refactor. In either case, you
know you need to fix the test eventually, but you don't want to deal with it
right now. This is a good use case for `skip`!

Instead of `skip`, you _could_ comment out the test and leave a `TODO`. However,
this approach is worse because it's much easier to forget that the test exists at
all. With `skip`, you get a reminder every time you run your test suite that
"you should probably fix these".

In the `rails/rails` test suite, we also use `skip` to indicate something is
missing from a developer's environment. For example, the Active Support test
suite contains tests for `ActiveSupport::Cache` that depend on `redis` and
`memcached`. If those services aren't running locally, the tests depending on
them are skipped[^rails] and a message is printed telling the developer why.

This is another good use of `skip`! It allows developers who aren't actively
working on `ActiveSupport::Cache` to run the Active Support test suite without
requiring them to set up more complex dependencies. But it also signals to those
developers that there _are_ more tests to run, they just aren't currently
running.

## Don't `skip` this next part

We've looked at a few good examples of using `skip`, but I also see it used in
places where it shouldn't be.

Here's a (not real) example using `ActiveSupport::Cache`:

```ruby
module SharedCacheTests
  def test_some_redis_specific_thing
    skip unless cache_store.is_a?(ActiveSupport::Cache::RedisCacheStore)

    # ... test code that only works for RedisCacheStore
  end
end
```

Don't use `skip` for this!

This is bad because it completely ruins the value of the `skip` signal. If _any_
tests are always skipped, then the test output will always have `S`s, and the
final `skips` count will always be nonzero. Both of these signals are useful
because of their rarity; if a developer sees them, they know there's something
for them to do. If `skip` is used for tests where there _isn't_ anything for a
developer to do, then the useful signals gets drowned out by the noise.

Another issue with using `skip` like this is the runtime cost: `minitest`'s
`skip` happens at test _runtime_. That means all the code before the `skip` call
still runs: any `setup`/`teardown` hooks in the test's own class as well as any
`setup`/`teardown` hooks in the test class' ancestors. Maybe you're lucky and
your test suite is fast enough that this doesn't matter, but in a larger
codebase this could add up to a significant amount of wasted time.

So, if you shouldn't use `skip` in these scenarios, what should you use instead?

There are (at least) three good alternatives.

In the `ActiveSupport::CacheStore` example above, the `skip`ped test is specific
to a particular cache store (`redis`). So really, it doesn't belong in the
shared tests for all cache stores. Put it where it belongs!

```ruby
module SharedCacheTests
  # ... shared tests for all cache stores
end

class RedisCacheStoreTest < Minitest::Test
  include SharedCacheTests

  def test_some_redis_specific_thing
    # ... test code that only works for RedisCacheStore
  end
end
```

Maybe you run your entire test suite with different configurations: instead of a
test class per backend you run tests against each backend in a separate
process[^backend]. Since each backend will have different capabilities, some
tests may not apply to every backend. Instead of conditionally `skip`ping those
tests, you can lift the conditional out of the test so that the test isn't even
defined if it shouldn't run.

```ruby
class CacheTest < Minitest::Test
  if cache_store.supports_multi_get?
    def test_multi_get
      # ...
    end
  end
end
```

Or, if you aren't using `minitest`, your test framework may have a way to
annotate tests so that they only run in certain scenarios.

```ruby
class CacheTest < Megatest::Test
  test "only works with redis", store: :redis do
    # ...
  end
end
```

```bash
# Skip tests that only work with redis
$ megatest ! :@store=redis
```

In all of these cases, the `skip` signals in the test output remain actionable
and the test suite remains fast, while still ensuring only the relevant tests
are run in each scenario.

## `skip` to the end...

`skip` is a powerful tool for signaling to developers that some tests aren't
running. However, it _must_ be used conservatively to ensure the signal retains
its value.

Luckily, there are many alternatives to `skip` for those cases where action
isn't required. Don't skip out on using them!

---

[^rails]: In `rails/rails` CI, `skip` will actually `fail` the test to ensure
    that the test suite isn't accidentally succeeding without running all of the
    tests.

[^backend]: For example, `rails/rails` runs the whole Active Record test suite
    against SQLite, PostgreSQL, and MySQL, each in their own process.
