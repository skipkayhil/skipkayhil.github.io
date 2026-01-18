---
title: "Base64, Endianness, and Idiots"
---

_Spoiler: The idiot is me._

I finally got my hands on _The Binding of Isaac: Rebirth_ during this Steam
Winter Sale. I've only had it for a little over a week, and its already been a
ton of fun. For what may appear to be a small game, it has a _ton_ of content,
with a whopping **641 achievements** to unlock[^1]. And while some of these
achievements can be earned at any time while playing, many of them are locked
behind various progression mechanics, meaning some achievements depend on others
being unlocked first.

With so many achievements to unlock, I wanted a plan to tackle them all. There
are a few high quality roadmaps in the Steam guides, but while they contain
great content they are unfortunately static, so I'd still have to manually keep
track of the next thing to unlock.

Naturally, I decided to create [an app][] which would track the achievements for
me in the context of these guides. This meant the app needed to have:

[an app]: https://skipkayhil.github.io/isaac

- state saving/loading
- prioritization
- dependency tracking

While the other things are also interesting, this post will focus on saving and
loading the state.

## {De,}Serializing Achievements

The first question to answer was where the state would be saved to and loaded
from. I knew I wanted a way to import my list of completed achievements from
Steam, so I decided to put the state in a query parameter. This would allow me
to generate URLs like `/?q=<serialized state>` and easily import completed
achievements.

The next question is what exactly `<serialized state>` should look like. This
felt like something to use `Base64` for, but I wasn't confident on exactly
_what_ should be `Base64` encoded.

My experience with `Base64` has been with `atob` / `btoa` in JavaScript and
`Base64.encode64` / `Base64.decode64` in Ruby, and these methods all take a
String as input. While I _could_ use a String by encoding the list of completed
achievements like `"1:2:4:5"`, this would get _very_ long as it approaches 100%
completion.

A better storage format would be 641 indexed bits, with 1 representing
completion and 0 representing non-completion. But when I tried `btoa("011011")`
/ `Base64.encode64("011011")`, I got `"MDExMDEx"`, which is _less_ compact than
the initial bit String.

Clearly I don't yet understand how `Base64` works, so let's fix that.

## WTF is Base64?

`Base64`'s alphabet look like this[^2]:

```
ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/
```

As indicated by the name, there are 64 characters in the alphabet, representing
the numbers 0 - 63. When something is `Base64` encoded, the bits are broken up
into groups of 6 (since 64 is 2<sup>6</sup>), and then converted into one of the
characters in the alphabet. So `0 -> A`, `34 -> h`, `54 -> 2`, etc.

Going back to the example from earlier, if I have 6 bits like `011011`, I would
_expect_ `Base64` encoding them to result in `b`. The issue of course is the
String `"011011"` is _not_ the same as the bits `011011`:

```ruby
bytes_as_string = "011011".bytes.map { it.to_s(2).rjust(8, "0") }.join
# => "001100000011000100110001001100000011000100110001"
```

and when broken up into chunks of 6 to `Base64` encode we can see how we got the
result from before:

```ruby
#               4
#               ⌄
ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
#              ^        ^                                    ^
#              3        12                                   49

encoded_indexes = bytes_as_string.chars.each_slice(6).map { it.join.to_i(2) }
# => [12, 3, 4, 49, 12, 3, 4, 49]

encoded_indexes.map { ALPHAPBET[it] }.join
# => "MDExMDEx"
```

So what I need is _not_ an API that takes Strings, but something that accepts
raw bytes. Luckily, the [MDN page][] for `Base64` encoding points us in the
right direction: `Uint8Array.fromBase64()` and
`Uint8Array.prototype.toBase64()`.

[MDN Page]: https://developer.mozilla.org/en-US/docs/Glossary/Base64#javascript_support

## The First Attempt

Newly equipped with `Uint8Array`, I wrote up my first working solution:

```js
// isCheckedArray looks like:
// [false, true, true, false, true, true, false, false, ...]
const toQuery = (isCheckedArray) => {
  // 81 * 8 = 648, which is the first multiple of 8 greater than 641
  let uint8Array = new Uint8Array(81);

  for (let i = 0; i < 81; i++) {
    let uint8 = 0;

    for (let j = 0; j < 8; j++) {
      if (isCheckedArray[i * 8 + j]) {
        uint8 |= 1 << j;
      }
    }

    uint8Array[i] = uint8;
  }

  return uint8Array.toBase64({ alphabet: "base64url" });
};
```

and if we give this function the same bits as before:

```js
let checked = new Array(648);
[1, 2, 4, 5].forEach(i => checked[i] = true);

toQuery(checked)
// => "NgAAAAA..."
```

Oh. We get a `Base64` encoded String that starts with `N`, but didn't we expect
to get `b` from `011011`?

Since this post is being written with hindsight, we can already see that
something weird is going on. But at this point I was able to successfully save
and load the list of completed achievements, so I didn't yet know that there was
a bug. We'll revisit this momentarily.

The next thing to do is write the code which will take a Steam profile and
generate the URL.

## The Second Attempt

For this part, we need to scrape the Steam achievement page and parse the HTML
to get a list of completed achievements. Even though the app is written in
JavaScript, I'm much more comfortable writing this kind of script in Ruby. The
scraping isn't too interesting for this post, so we'll just focus on the
`Base64` implementation.

As I mentioned before, Ruby has a `base64` gem which provides `Base64.encode64`
and `Base64.decode64`. Unfortunately these only accept Strings, and I didn't see
an alternative API that would accept something similar to the `Uint8Array` in
JavaScript. That's okay, I'll just do it myself:

```ruby
def encode(checked_array)
  s = +"";

  checked_array.each_slice(6) do |slice|
    i = 0

    slice.each_with_index do |b, index|
      i |= (1 << index) if b
    end

    s << ALPHABET[i]
  end

  s
end
```

Like the JavaScript version, the function accepts an Array of Booleans. But
unlike the JavaScript version which packs the booleans into a `Uint8Array`, the
Ruby version goes straight to 6 bit chunks and encodes them as `Base64`.

And when we try this version:

```ruby
checked = Array.new(648)
[1, 2, 4, 5].each { checked[it] = true }

encode(checked)
# => "2AAAAA..."
```

Oh. Something completely different from both the JavaScript version and the
initial example.

Okay, I guess its time to figure out exactly what's going wrong now.

## Endianness

Let's step through the JavaScript version to see how we end up getting an `N`.

Given an array of booleans like `[false, true, true, false, true, true, false
false]`, what does the `uint8` look like?

```js
for (let i = 0; i < 81; i++) {
  let uint8 = 0;

  for (let j = 0; j < 8; j++) {
    if (isCheckedArray[i * 8 + j]) {
      uint8 |= 1 << j;
    }
  }

  uint8Array[i] = uint8;
}
```

The outer loop iterates over the generated `uint8`s, so for this shortened array
`i` will always be `0`.

Then, `j` goes from `0` to `7`:

| `j` | `isCheckedArray[j]` | `1 << j` | `uint8` |
|-|-|-|-|
| `0` | `false` | - | `0`
| `1` | `true` | `10` | `10`
| `2` | `true` | `100` | `110`
| `3` | `false` | - | `110`
| `4` | `true` | `10000` | `10110`
| `5` | `true` | `100000` | `110110`
| `6` | `false` | - | `0110110`
| `7` | `false` | - | `00110110`

So `uint8` will be `00110110`. To encode that byte as `Base64`, it's broken up
into chunks of 6, with the second chunk padded to 6 bits:

```
001101 -> 13 -> N
100000 -> 32 -> g
```

And now its clear how we ended up with `Ng`. The issue here is the "endianness":
instead of the `uint8` being ordered as described before (`01101100`), they've
actually been flipped (`00110110`).

Once again, this post is written with hindsight, and I did not yet fully
understand the issue. What I did know is I had written an implementation of
`Base64` encoding in Ruby which did not have an intermediate step of creating
`uint8` values, so I decided I would replace my JavaScript implementation with
one equivalent to the Ruby version and surely they would then produce the same
values.

## Third Time's the Charm

The new JavaScript implementation looked like this:

```js
const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const toQuery = (isCheckedArray) => {
  let encodedString = "";

  for (let i = 0; i < 648; ) {
    let encodedIndex = 0;

    for (let j = 0; j < 6; j++) {
      if (isCheckedArray[i]) {
        encodedIndex |= 1 << j;
      }

      i++;
    }

    encodedString += alphabet[encodedIndex];
  }

  return encodedString;
};
```

and trying out this new version _does_ produce the same result as the Ruby
version:

```js
let checked = new Array(648);
[1, 2, 4, 5].forEach(i => checked[i] = true);

toQuery(checked)
// => "2AAAAAA..."
```

But as I mentioned earlier, even this result doesn't match our initial
expectation. It still has an endianness problem!

## Meeting Expectations

We _should_ be encoding an array like `[false, true, true, false, true, true]`
as `011011`, but instead its being encoded as `110110`. Understanding the issue
took some work, but the fix is simple:

```diff
diff --git a/bin/steam b/bin/steam
index 6539dad..56c6e2c 100755
--- a/bin/steam
+++ b/bin/steam
@@ -39,7 +39,7 @@ when Net::HTTPSuccess
   all_checked.each_slice(6) do |slice|
     i = 0

-    slice.each_with_index do |b, index|
+    slice.reverse.each_with_index do |b, index|
       i |= (1 << index) if b
     end

diff --git a/index.html b/index.html
index e1ba33d..072db59 100644
--- a/index.html
+++ b/index.html
@@ -38,7 +38,7 @@
         for (let i = 0; i < 648; ) {
           let encodedIndex = 0;

-          for (let j = 0; j < 6; j++) {
+          for (let j = 5; j >= 0; j--) {
             if (allChecked[i]) {
               encodedIndex |= 1 << j;
             }
```

And now, finally, both Ruby and JavaScript implementations match our expectation:

```ruby
encode(checked)
# => "bAAAAA..."
```

```js
toQuery(checked)
// => "bAAAAA..."
```

## I'm the Idiot

Something I find really important when debugging an issue is ensuring that I
fully understand how code works in order to properly fix it. One of my biggest
pet peeves is when someone proposes a change to fix a bug, but they can't
explain _why_ the bug is fixed. To me, fixing the bug isn't really the point,
the goal should be to find the incorrect code and make it correct.

Of course, that flawed process is exactly what I did here: I knew that something
was wrong with the `Uint8Array` JavaScript implementation, but instead of
exactly identifying the problem I just rewrote the code and made it go away. Had
I dug deeper initially, I may have realized the bit order was the real issue and
I could have kept the `Uint8Array` around.

To be fair, this app isn't a very serious project (yet?) so this wasn't a big
deal, but it was definitely a good reminder for why I find it so important to
understand bugs before fixing them.

Anyways, I've definitely now learned some new things about `Base64`, hopefully
you have too!

---

[^1]: And some people unlock the 641 achievements on each of three save files 🤯

[^2]: There's also a URL-safe version which uses `-_` instead of `+/`
