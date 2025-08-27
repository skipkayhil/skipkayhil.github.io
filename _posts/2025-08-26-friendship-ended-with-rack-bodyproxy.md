---
title: "Friendship Ended with Rack::BodyProxy"
canonical_url: https://railsatscale.com/2025-08-26-friendship-ended-with-rack-bodyproxy/
---

*Originally published on [Rails At Scale]({{ page.canonical_url }})*

Now `rack.response_finished` is my best friend.

## Rack is deeper than you thought

If you've heard of Rack, you've probably seen an example like this:

```ruby
# config.ru

class Application
  def call(env)
    [200, {}, ["Hello Rack"]]
  end
end

run Application.new
```

The application responds to `#call` with a single argument, the `environment`,
and returns an array of `status`, `headers`, `body`. All of the concepts seem
straightforward, right? The `status` is an Integer, the `environment` and
response `headers` are Hashes, and the `body` is an Array of Strings.

While this _is_ a valid Rack application, that's not really the end of the
story. For the whole picture, we have to read the Rack SPEC.

For this post, let's focus on the [specification of the `body`][]. The
requirements have evolved over time, but something that hasn't changed since the
earliest versions[^1] of Rack is that enumerable bodies should respond to
`#each`, `yield`ing strings.

[specification of the `body`]: https://github.com/rack/rack/blob/ee7ac5a1db5bc5c65e4b83342b8f4df88ef3c075/SPEC.rdoc#the-body-

That means an application that prefers not to buffer its entire response into
memory could implement the body like this:

```ruby
# config.ru

class Body
  def each
    yield "Hello Rack"
  end
end

class Application
  def call(env)
    [200, {}, Body.new]
  end
end

run Application.new
```

Now things are more complicated.

In the "Array of Strings" example, it's trivial for middleware to do something
after the body is generated:

```ruby
class LoggerMiddleware
  def call(env)
    response = @app.call(env)

    logger.info "Request processed!"

    response
  end
end
```

But in the "`Body` class" example, the body's content isn't generated until the
web server calls `#each` on it. Since this happens after the middleware's
`#call` has returned, how can the middleware do things afterwards?

## Enter `BodyProxy`

Luckily, the Rack specification also [includes][] a hook

[includes]: https://github.com/rack/rack/blob/df0c8d01f69d63b474f86afe1eaf44bc0be5169f/lib/rack/lint.rb#L358

> If the body responds to #close, it will be called after iteration

And this is where `Proxy` objects come into play: they can intercept the call to
`#close` on the body so that middleware have an opportunity to do things after
the body has been iterated.

The first `Proxy` class was [introduced][] in Rack to fix `Rack::Lock` unlocking
before an enumerable body was iterated. Soon after, it was [extracted][] to the
`Rack::BodyProxy` class that's widely used today.

[introduced]: https://github.com/rack/rack/commit/3bf865524e23e4bd6207557dac16e41fd9c450db
[extracted]: https://github.com/rack/rack/commit/dec966d2931675aaa1c049244734ee87581b20ad

```ruby
class LoggerMiddleware
  def call(env)
    status, headers, body = @app.call(env)

    body = Rack::BodyProxy.new(body) do
      logger.info "Request processed!"
    end

    [status, headers, body]
  end
end
```

## Where's the beef?

While `BodyProxy` enables middleware to do things after a response body has been
generated, it isn't a perfect solution.

The most obvious flaw is that each middleware ends up allocating its own
`BodyProxy` object. With many middleware, the response body can end up looking
like

```ruby
BodyProxy.new(BodyProxy.new(BodyProxy.new(BodyProxy.new(["actual body"]))))
```

Ruby object allocations are getting [faster][], but they are still frequently a
performance bottleneck. Each allocation creates work for the garbage collector,
which slows down your application. A better alternative would be something that
avoids allocations altogether.

[faster]: https://railsatscale.com/2025-05-21-fast-allocations-in-ruby-3-5/

Another issue with `BodyProxy` is that it may run too early in the request
life cycle to perform certain tasks. GitHub has [previously written][] about how they couldn't use
`Rack::Events` (which uses `BodyProxy`) for metric emission because it made
pages appear to keep loading until the metrics finished emitting.

[previously written]: https://github.blog/engineering/architecture-optimization/performance-at-github-deferring-stats-with-rack-after_reply/

At Shopify, we saw a similar issue: our web server Pitchfork would keep the
connection open to our reverse proxy while emitting metrics, which increased the
proxy's open connection count and resulted in worse performance.

GitHub's (and our) solution to this problem was to move metric emission
somewhere that runs later than `BodyProxy` to ensure the connection is
completely closed: `rack.after_reply`.

## A blossoming friendship

`rack.after_reply` began life shortly after `BodyProxy`: it was [added][] to
Puma in 2011 as a simple array of callables in the request `environment` that
would run after closing the response body.

[added]: https://github.com/puma/puma/commit/be4a8336c0b4fc911b99d1ffddc4733b6f38d81d

Since then, it has been added to [Unicorn][] and later [became an optional
part][] of the Rack 3 SPEC as `rack.response_finished`.

[Unicorn]: https://yhbt.net/unicorn.git/673c15e3f020bccc0336838617875b26c9a45f4e/s/
[became an optional part]: https://github.com/rack/rack/commit/856c4f9a81c3c1e73b02a0c2937225aaeef5ff64

A web server can indicate that it supports `rack.response_finished` by including
it in the request `environment`, and middleware can register callbacks by
appending to it

```ruby
class LoggerMiddleware
  def initialize
    @callback = ->(env, status, headers, error) {
      logger.info "Request processed!"
    }
  end

  def call(env)
    # Look ma, no allocations!

    if response_finished = env["rack.response_finished"]
      response_finished << @callback
    end

    @app.call(env)
  end
end
```

The callbacks must[^2] accept four arguments: the request `environment`,
response `status`, response `headers`, and an `error`. The `environment` should
always be present, but the `status`/`headers` and `error` are mutually
exclusive.

## So why is `BodyProxy` still around?

Adoption of `rack.response_finished` has been... slow. It's also very much a
chicken/egg problem: applications and frameworks don't have a reason to support
it without servers that implement it, and servers don't have a reason to
implement it if applications and frameworks don't support it[^3].

[Falcon implemented][] `rack.response_finished` in anticipation of the release
of Rack 3, but there wasn't a second implementation until Pitchfork added it
[just last year][].

[Falcon implemented]: https://github.com/socketry/protocol-rack/commit/10b8ade7963ccef2c775141b432e3713e06d57f7
[just last year]: https://github.com/Shopify/pitchfork/commit/7ac65bb8fee3064eb7d7a602bfeeb71155b5e3c0

However, `rack.response_finished` finally started gaining momentum when the new
[Rails Event Reporter][] pull request was opened.

[Rails Event Reporter]: https://github.com/rails/rails/pull/55334

As I mentioned before, at Shopify we emit metrics inside a `rack.after_reply` /
`rack.response_finished` callback so that we don't keep the connection open
unnecessarily after the response has been sent. For the same reason, this is
also where we log summaries of requests (using the Event Reporter).

This presented an interesting challenge when upstreaming the Event Reporter to
Rails. The Event Reporter's `context` needs to be cleared so that it doesn't
leak between requests, but the existing mechanism for request isolation (the
`ActionDispatch::Executor` middleware) uses `BodyProxy`. Using `BodyProxy` would
mean the `context` would be cleared _before_ we're able to use it to log the
request summary in `rack.response_finished`.

To make this work, my teammate [Adrianna][] and I [added support][] for
`rack.response_finished` to `ActionDispatch::Executor`.

[Adrianna]: https://railsatscale.com/authors/adrianna-chang/
[added support]: https://github.com/rails/rails/commit/936e161a78c750f1c54701cd7f89f7a5f3c4e195

This enabled the `Executor` to clear the Event Reporter `context` between
requests using `rack.response_finished`, meaning our request summary log would
still have access to it!

## Now `rack.response_finished` is my best friend

Since we implemented `rack.response_finished` in `ActionDispatch::Executor`,
I've been looking to replace `BodyProxy` in other Rack middleware used by my
application.

Rack 3.2 will have a few less `BodyProxy`s as both [`Rack::ConditionalGet`][] and
[`Rack::Head`][] no longer use them.

[`Rack::ConditionalGet`]: https://github.com/rack/rack/commit/6828a1767e4f3bd535de506d95ff5686b254fa90
[`Rack::Head`]: https://github.com/rack/rack/commit/9e10390006fec1fafe100d39f2e15698a2bf7d74

I've also opened pull requests to add support for `rack.response_finished` in
[`Rack::TempfileReaper`][] and
[`ActiveSupport::Cache::Strategy::LocalCache`][local cache].

[`Rack::TempfileReaper`]: https://github.com/rack/rack/pull/2363
[local cache]: https://github.com/rails/rails/pull/55447

Finally, Puma just recently [merged][] support for `rack.response_finished` as
well!

[merged]: https://github.com/puma/puma/commit/1b08ed77741d0f6ed17c43795df7b50601d09060

With all this momentum behind `rack.response_finished`, maybe you can end your
friendship with `Rack::BodyProxy` too.

---

[^1]: I was actually curious how long Rack has had this requirement so I went
    git spelunking: [the initial addition][] of `Rack::Lint` included it!

[^2]: `MUST` was actually only [recently added][] to the `SPEC` to prevent
    defining callbacks that accept no arguments (like `-> {}`).

[^3]: And to be fair, Puma, Unicorn, and Pitchfork all support
    `rack.after_reply` already, it's just not part of the Rack `SPEC`.

[the initial addition]: https://github.com/rack/rack/blob/9eda64e7873ca5eaf16992af6f9487fb68436a15/lib/rack/lint.rb#L145
[recently added]: https://github.com/rack/rack/commit/79d6820b73d9084a60ec1f9912e3ab00439bd5d3
