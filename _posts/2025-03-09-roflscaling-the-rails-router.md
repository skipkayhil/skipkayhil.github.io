---
title: "ROFLScaling the Rails Router"
---

I recently contributed to a series of optimizations to Journey (Rails' router).
A few people have asked me to talk about these changes, so I wanted to highlight
a few of my favorites.

## But First, Some Background

The foundational data structure in the router is a [Generalized Transition
Graph][]. Explaining it fully is a little too much for this post, but the
important thing to know is there is a mapping of "current state" to "condition"
to "next state". The "condition" determines whether we can move between states.
In concrete terms it looks like this:

[Generalized Transition Graph]: https://en.wikipedia.org/wiki/Generalized_nondeterministic_finite_automaton

```ruby
{
  0 => {
    "/" => 1,
  },
  1 => {
    "posts" => 2,
    "comments" => 3,
  },
}
```

So if the router is parsing a request's path like `/posts`, it
- starts at state 0
- the next character is `/` so it "transitions" to state 1
- the next set of characters is `posts` so it "transitions" to state 2

And state 2 will end up pointing to `PostsController#index`.

## Flattening Data Structures

Something missing from the explaination above is how the router handles dynamic
segments (like `:id` params). These are defined in a _separate_ transition hash,
where the condition requires the segment to match a regular expression named
`DEFAULT_EXP` (for now just know its a regex, we'll come back to it later).

```ruby
{
  2 => {
    DEFAULT_EXP => 4,
  },
  3 => {
    DEFAULT_EXP => 5,
  },
}
```

You may notice that these transitions look redundant, _because they are_. Every
single value in this hash is just a hash with a single key. So my [first
commit][] in this series was flattening this hash:

```ruby
{
  2 => 4,
  3 => 5,
}
```

Flattening data structures like this has two primary benefits. The most obvious
one is that the router now uses less memory because it no longer retains tons of
identically shaped hashes. The more subtle benefit is the removal of
indirection:

```ruby
if states = @stdparam_states[s]
  # this `each` is wasteful: `states` is always one element!
  states.each { |_, std_state| next_states << [std_state, nil] }
end

# can now become

if std_state = @stdparam_states[s]
  next_states << [std_state, nil]
end
```

[first commit]: https://github.com/rails/rails/commit/3fac13e09c4f067a8084e5b470691ceb711a9241

Another data structure in the router was [flattened by byroot][]: the `states`
arrays that hold the router's states.

```ruby
[
  [1, nil],
  [5, nil],
]
```

As shown in the code snippets above, each new state is a tiny array appended to
the `next_states` array. The issue in this case is not retained memory usage but
memory allocations. Every time we add a new state, we have to allocate a whole
new array!

Instead, the `next_states` array can be flattened:

```ruby
[1, nil, 5, nil]
```

and populating `next_states` changes similarly:

```ruby
current_states.each do |s, i|
  if std_state = @stdparam_states[s]
    next_states << [v, nil]
  end
end

# can now become

current_states.each_slice(2) do |s, i|
  if std_state = @stdparam_states[s]
    next_states << v << nil
  end
end
```

Now, instead of allocating, elements are pushed directly into `next_states` and
iterated over in slices (2 at a time). This approach is about 10% faster.

[flattened by byroot]: https://github.com/rails/rails/commit/69bfc52842c6e9bdab073e6a25996b10d53465e1

## Other Allocation Reductions

I've talked about the data structures in the router but haven't yet said much
about how they are used. The central object that orchestrates routing is the
`Simulator`, which breaks down a path into tokens and passes them into the
transition graph's `#move` method.

<blockquote class="note">

`#move` is the method shown in the snippets above that populates the
`next_states` array.

</blockquote>

The `Simulator` originally looked like this:

```ruby
input = StringScanner.new(path)
state = INITIAL_STATE
start_index = 0

while sym = input.scan(%r([/.?]|[^/.?]+))
  # These two lines are actually inside #move
  # but I've inlined them here for simplicity
  tok = path.slice(start_index, sym.length)
  stdparam_match = DEFAULT_EXP.match?(tok)

  tt.move(..)
end
```

Honestly, the regex in that `#scan` was pretty hard for me to understand at
first.

The `#scan` is looking for either: a single `/`, `.`, or `?`, OR multiple
characters in a row that aren't one of those three. Then, the length of that
scanned String is used to `#slice` the matched token from the path. Finally, it
checks which of the two cases matched by matching the token against
`DEFAULT_EXP`.

<blockquote class="note">

There's `DEFAULT_EXP` again! The actual regex is `/[^\/.?]+/`, which matches a
String that doesn't contain any `/`, `.`, or `?`.

</blockquote>

There were a few issues with this code.

Firstly, there's a lot of duplication. `#scan` allocates a matched string, but
only its length gets used. Then that matched string gets reallocated by
`#slice`. Finally, a _second_ regex match is needed because the `Simulator`
doesn't know which of the two cases were matched by the original `#scan`.

Additionally, every time `#scan` matches `/`, `.` or `?`, a brand new String is
allocated even though these single character Strings show up quite frequently.

My initial approach to optimizing this method fixed all of these issues and was
about 10-15% faster.

```ruby
input = StringScanner.new(path)
state = INITIAL_STATE

until input.eos?
  start_index = input.pos

  if (token = STATIC_TOKEN[path.getbyte(start_index)])
    input.pos += 1
    stdparam_match = true
    
    state = tt.move(...)
  else
    token = input.scan(DEFAULT_EXP)
    stdparam_match = false

    state = tt.move(...)
  end
end
```

The basic idea is to avoid `#scan` allocations by first checking whether the
next byte in the `StringScanner` is one of `/.?` and, if it is, use an existing
frozen string for the token. Additionally, this separates the two different
`#scan` cases logically so that the `#match?` becomes unnecessary.

When I submitted this PR, byroot had a suggestion to make it perform _even
faster_. What if we replace the `StringScanner` completely?

```ruby
state = INITIAL_STATE
pos = 0
eos = path.bytesize

while pos < eos
  start_index = pos
  pos += 1

  if (token = STATIC_TOKEN[path.getbyte(start_index)])
    stdparam_match = true
    state = tt.move(...)
  else
    while pos < eos && STATIC_TOKEN[path.getbyte(pos)].nil?
      pos += 1
    end

    token = path.byteslice(...)
    state = tt.move(...)
  end
end
```

Now in addition to the string allocations and `#match?` being removed, we've
also removed the `StringScanner` allocation (which previously happened once per
path) and ALL regex matching. The [final version][] of the change improved
performance by 25-35%.

[final version]: https://github.com/rails/rails/commit/c1c528d9f26195d08028caa0a8cc8bee4e14d962

## Offload Complexity from Happy Path

A problem I often see is that more advanced features can introduce complexity
that inadvertantly make more simple features slower. One example of this was in
the router's HTTP verb matching implementation.

The original code looked like this:

```ruby
# There's a matcher class for each verb
class GET
  def self.call(request)
    request.get?
  end
end

def match_verb(request)
  # request_method_match is an array of matcher classes
  @request_method_match.any? { |matcher| matcher.call(request) }
end
```

While this code enables applications to define routes matching multiple HTTP
verbs, it's also written in a way that makes "single verb" routes pay the cost of
calling `Array#any?`. Ideally, only routes that actually match multiple HTTP
verbs would have to do anything with an `Array`.

I [addressed this][] by introducing a new `Or` matcher class:

```ruby
class Or
  def call(request)
    @verbs.any? { |m| m.call(request) }
  end
end
```

which enabled simplifying the common case:

```ruby
def match_verb(request)
  @request_method_match.call(request)
end
```

Instead of being an array, `@request_method_match` is now always a single
callable: either the route's single verb matcher, or an instance of `Or` that
wraps multiple verb matchers.

[addressed this]: https://github.com/rails/rails/commit/81f1ca2de4dd0f880834d4a790ae779d2c377d1f

## Equality Order

[This one's][] too funny not to share.

[This one's]: https://github.com/rails/rails/commit/cc7c359e313d255f1ed6b40c5010378b04707e98

While looking at profiles, I noticed that `String#==` was showing up as about
2.5% of the total time. This was kind of surprising to me since I would expect
this to be a pretty fast operation.

The method call itself looked pretty simple

```ruby
_, headers, _ = route.app.serve(req)

if "pass" == headers["x-cascade"]
  # If the x-cascade response header is "pass", then the router should return a
  # 404 response
end
```

In Ruby, its generally good practice to call methods on objects that you
control. That's why you'll often see `eql?` methods defined like

```ruby
def eql?(other)
  # calling `===` on self.class prevents unexpected results
  # if `other` has a custom `===` definition
  self.class === other && version == other.version
end
```

So going back to the router, it makes sense that `#==` is called on `"pass"`
because `headers["x-cascade"]` is an unknown value. However, it turns out
swapping the order in this case can actually be _faster_ without sacrificing
correctness.

The first thing to recognize is that the value of the `x-cascade` header is
restricted by the [Rack Spec][]:

[Rack Spec]: https://github.com/rack/rack/blob/e6376927801774e25a3c1e5b977ff2fd2209e799/SPEC.rdoc#the-headers-

> Header values must be either a String value, or an Array of String values...

and in practice, `x-cascade` is really either `"pass"` or unset. This means the
common case (not a 404) will be `"pass" == nil`, and the uncommon case will be
`"pass" == "pass"`.

While reading the [docs for `String#==`][string-eq-eq], this note stood out as
important to me:

[string-eq-eq]: https://docs.ruby-lang.org/en/3.4/String.html#method-i-3D-3D

> If `object` is not an instance of String but responds to `to_str`, then the
> two strings are compared using `object.==`.

Since the common case is comparing a String with `nil`, `String#==` ends up
having to do `nil.respond_to?(:to_str)` before it can confirm that the two
objects are not the same! On the other hand, if the comparison order is swapped
then `NilClass#==` gets called instead, which is a very cheap comparison of the
underlying Ruby `VALUE` objects.

## So did we ROFLScale?

When working on performance, its important to contextualize any improvements.

> A ~30% gain is nice, but it's 30% of something that's already not much (6μs on
> my machine).

Will these changes make your real app dramatically faster? Probably not.

However, microbenchmarks like the [TechEmpower Framework Benchmarks][] are often
cited when comparing different languages and frameworks. Because these
benchmarks are less representative of real applications, they can magnify parts
of a language or framework that may not be as performance critical otherwise.

[TechEmpower Framework Benchmarks]: https://github.com/TechEmpower/FrameworkBenchmarks

For the TechEmpower benchmarks in particular, there's a larger emphasis on
routing because the controller actions are so minimal. While a real application
may not benefit from μs speedups to the router, every bit of performance counts
in a competition like this.

> Ah, so the goal is to go ROFLscale.

To measure the total improvement, let's look at the `/plaintext` route as it
appeared in Round 23 of the benchmark.

The route itself is quite simple, it doesn't even use a controller:

```ruby
Rails.application.routes.draw do
  get "plaintext", to: ->(env) do
    [200,
     {
       'Content-Type' => 'text/plain',
       'Date' => Time.now.httpdate,
       'Server' => 'Rails'
     },
     ['Hello, World!']]
  end
end
```

To get a baseline, I changed the Rails version to the most recent release
(8.0.2) and ran a benchmark that looks something like this:

```ruby
app = Rails.application
env = {
  "REQUEST_METHOD" => "GET",
  "PATH_INFO" => "/plaintext",
}

Benchmark.ips do |x|
  x.report { app.call(env) }
  x.compare!
end
```

```
ruby 3.4.5 (2025-07-16 revision 20cda200d3) +YJIT +PRISM [x86_64-linux]
Warming up --------------------------------------
           1 request     1.983k i/100ms
Calculating -------------------------------------
           1 request     20.295k (± 1.7%) i/s   (49.27 μs/i) -    103.116k in   5.082283s
```

Then I changed the application's Rails version to [`main`][] and ran the
benchmark again:

[`main`]: https://github.com/rails/rails/commit/aa2bfad1a137c9add1b35de118b391494e13ca06

```
ruby 3.4.5 (2025-07-16 revision 20cda200d3) +YJIT +PRISM [x86_64-linux]
Warming up --------------------------------------
           1 request     3.621k i/100ms
Calculating -------------------------------------
           1 request     37.838k (± 2.1%) i/s   (26.43 μs/i) -    191.913k in   5.074107s
```

With all of the changes to Journey, Rails is able to route almost twice as many
requests per second![^1]

I'm definitely looking forward to seeing these changes released in Rails 8.1 so
that the improvements will be visible in the next round of the benchmark.

---

[^1]: Note that my comparison is looking strictly at the amount of time spent
    inside the Rails application. The TechEmpower benchmarks measure the
    performance of Rails with a web server (Puma, Falcon, etc.), so a 2x speedup
    to Rails is only improving a portion of a request's total duration.
