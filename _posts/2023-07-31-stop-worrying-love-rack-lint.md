---
title: "How I Learned to Stop Worrying and Love Rack::Lint"
description: A retrospective on a hackathon project I lead to add Rack::Lint to Rails.
---

For a recent Hackathon at Shopify, I created the [Rack::Lint on Rails][rl on
rails] project, where I had the opportunity to lead a team in adding additional
test coverage to Rails to ensure it follows the [Rack SPEC][rack spec].

[rl on rails]: https://github.com/rails/rails/issues/48874
[rack spec]: https://github.com/rack/rack/blob/main/SPEC.rdoc

## So the project was writing tests? Why would you do that?

The original motivation was to help the effort to support Rack 3 in the next
version of Rails. Rack 3 is the latest version of the Rack specification, and it
came with a number of breaking changes from Rack 2. You can read about all of
the changes in the [upgrade guide][], but the most important one to be aware of
is that Rack 3 added a new requirement for all response headers to be lowercase.
In Rack 2 applications, `Content-Type` is a valid response header, but in Rack 3
it must be `content-type`.

[upgrade guide]: https://github.com/rack/rack/blob/main/UPGRADE-GUIDE.md

While a lot of work had been done already to have Rails support Rack 3, I had
seen some `Content-Type` headers sprinkled around the code and these weren't
being caught by existing tests. Instead of trying to craft the perfect regular
expression to find these headers, I thought the best way to catch them would be
using `Rack::Lint`.

## Wait, what is Rack?

Rack is a specification that defines a standard way for web servers, web
frameworks, and other web libraries to model web applications. This common
interface is what enables Rails applications to easily switch between web
servers like Unicorn and Puma, and it's what makes the `rack-cors` gem
compatible with Rails, Sinatra, Hanami, etc.

The most basic Rack application looks like this:

```ruby
App = ->(env) { [200, {}, ["OK"]] }
```

and the SPEC formalizes this:

> A Rack application is a Ruby object (not a class) that responds to `call`. It
> takes exactly one argument, the **environment** and returns a non-frozen Array of
> exactly three values: The **status**, the **headers**, and the **body**.

("environment" is really just a scary name for the request)

Rack applications are the basic building blocks of the Rack ecosystem. Another
important concept, Rack middleware, builds on the foundation of a Rack
application:

```ruby
class Middleware
  def initialize(app)
    @app = app
  end

  def call(env)
    @app.call(env)
  end
end
```

While not defined in the SPEC, Rack middleware are also an important building
block. A middleware is simply a Rack application that calls another Rack
application and returns its response instead of creating a response itself. On
its own, the example Middleware above isn't terribly useful, and most middleware
will do more than just delegate to another application. Some middleware modify
the environment before calling another app, others modify an app's response
before returning it, and some even do both.

## And Rack::Lint?

Something I find really cool about Rack is that it actually defines its
specification as a Rack middleware. While the [SPEC][rack spec] is a document
for humans to read, it is not written on its own. The whole file is actually
generated from the comments written in the `Rack::Lint` middleware, which is
part of the Rack library. What makes this so cool is that you can use
`Rack::Lint` to _programmatically_ validate that your code follows the Rack SPEC
(and the SPEC even suggests doing this!). To validate that a Rack application is
returning a valid response, you can wrap it like this:

```ruby
App = ->(env) { [200, {}, ["OK"]] }
LintedStack = Rack::Lint.new(App)
```

and to validate middleware, you should put `Rack::Lint` both before and after
your middleware:

```ruby
App = ->(env) { [200, {}, ["OK"]] }

class Middleware
  def initialize(app)
    @app = app
  end

  def call(env)
    @app.call(env)
  end
end

LintedStack = Rack::Lint.new(
  Middleware.new(
    Rack::Lint.new(App)     
  )
)
```

When a request is sent through either of these "stacks", a `LintError` will be
raised if there are any violations of the SPEC.

## What went well?

The team ended up with around 20 PRs merged in Rails, and we ended up fixing
many compatibility issues along the way! Some were the obvious header casing
issues described before, but there were many subtle places where Rails was
behaving incorrectly for Rack 3 _and_ Rack 2 that we were able to find and fix.

For example, this middleware had a problem:

```ruby
module ActionDispatch
  class AssumeSSL
    def initialize(app)
      @app = app
    end

    def call(env)
      env["HTTPS"] = "on"
      env["HTTP_X_FORWARDED_PORT"] = 443
      env["HTTP_X_FORWARDED_PROTO"] = "https"
      env["rack.url_scheme"] = "https"

      @app.call(env)
    end
  end
end
```

While the "namespaced" environment keys (ex. `rack.url_scheme`) can map to any
value, the "CGI keys" (everything without a `.`) MUST have string values. I
think this example really demonstrates where `Rack::Lint` shines: it makes it
super easy to catch these types of issues where something subtly doesn't
conform to the SPEC.

Something else I'm very happy with is how easy it was for us to use
`Rack::Lint`. Adding it to unit tests for a Rails middleware was as simple as
replacing `Middleware.new(app)` with
`Rack::Lint.new(Middleware.new(Rack::Lint.new(app)))`. Our team also discussed
writing a test helper to make it even easier to wrap things in `Rack::Lint`, but
we didn't end up getting to it during the Hackathon.

## What was hard?

While adding `Rack::Lint` to the Rails test suite was overall a positive
experience, I do want to mention some of the challenges we encountered.

Something to note about `Rack::Lint` is that it _always_ validates both the
environment and response that pass through it. This first showed up in tests
with these kinds of errors:

```
env missing required key REQUEST_METHOD (Rack::Lint::LintError)
```

The Rack SPEC has a minimum set of keys that the environment must contain, and
`Rack::Lint` validates these keys even if they aren't strictly required to test
a middleware. So tests that previously looked like this:

```ruby
stack.call({})
```

we had to update like this:

```ruby
env = Rack::MockRequest.env_for("", {})
stack.call(env)
```

`#env_for` takes a URL and an environment as parameters, and merges the given
environment into a new environment with default values for all of the required
keys. While slightly more verbose, this made it easy to keep the simplicity of
tests that just pass an environment through the middleware stack.

Another thing to keep in mind is that using `Rack::Lint` means the thing being
tested must be treated as a black box that follows the Rack SPEC.

Let's look at a (simplified) test in Rails that this affected:

```ruby
def test_returned_body_object_behaves_like_underlying_object
  app = ->(_) { [200, {}, ["hello", "world"] }
  # ...
  assert_equal 2, response[2].size # undefined method `size' for #<Rack::Lint::Wrapper >
end
```

The Rack SPEC does not dictate that response bodies can or should implement
`#size`, so `Rack::Lint` prevents us from using it in the test. To fix this
test, we need to write it in a way that only uses methods defined in the
Rack SPEC. For example, since response bodies must define `#each` (in Rack 2),
we could rewrite the test like this:

```ruby
def test_returned_body_object_behaves_like_underlying_object
  app = ->(_) { [200, {}, ["hello", "world"] }
  # ...
  assert_equal 2, response[2].enum_for.to_a.length
end
```

Finally, there were some other tricky tests that needed to change to work with
`Rack::Lint`. Rails has a test for routing different request methods that looks
like this:

```ruby
routes.draw do
  match "/" => ->(env) [200, {"Content-Type" => "text/plain"}, ["HEAD"]] }, :via => :head
end

test "request method HEAD can be matched" do
  get "/", headers: { "REQUEST_METHOD" => "HEAD" }
  assert_equal "HEAD", @response.body
end
```

This test works by defining a router that matches HEAD requests to a Rack
application that returns "HEAD" in the response body. So to ensure that the
`:via => :head` matching works properly, the test can just assert that the
response body contains "HEAD". However, when wrapped in `Rack::Lint` this test
raised an error:

```
Response body was given for HEAD request, but should be empty (Rack::Lint::LintError)
```

This one also required a bit of creativity to fix. While the SPEC prevents us
from returning a body, we're still able to return headers! So I ended up
modifying the test like this:

```ruby
routes.draw do
  match "/" => ->(env) [200, {"x-request-method" => "HEAD"}, []] }, :via => :head
end

test "request method HEAD can be matched" do
  get "/", headers: { "REQUEST_METHOD" => "HEAD" }
  assert_equal "HEAD", @response.headers["x-request-method"]
end
```

## Stop worrying!

Even though I listed some of the challenges we encountered with `Rack::Lint`, I
think it's important to emphasize that the solutions to these challenges ended
up being relatively simple. Over the 20 middleware test files we changed, these
were really the hardest problems we faced, and they only happened in a handful
of tests.

If anything, this project convinced me of just how important it is for libraries
implementing Rack to test their code with `Rack::Lint`. Most RFCs and
specifications don't come with such a useful tool, and Rack library authors
should absolutely be taking advantage of it. Following a specification like Rack
can be _hard_, but everyone can stop worrying by learning to love `Rack::Lint`.
