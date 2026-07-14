---
title: "We Accept the Headers We Think We Deserve"

# in case the newmediacampaigns post goes down:
#
# image/jpeg, application/x-ms-application, image/gif,
# application/xaml+xml, image/pjpeg, application/x-ms-xbap,
# application/x-shockwave-flash, application/msword, */*
---

I've heard that the `Accept` headers sent by browsers used to be bad, but I
didn't know just _how_ bad they were until recently.

Naturally, this was prompted by a [pull request to Rails][pull request].

> Rails has used a workaround since 2010 that assumes any `Accept` header
> containing `*/*` is from a browser and defaults to HTML

Oh, that's kinda odd. Why does it do this?

[pull request]: https://github.com/rails/rails/pull/57579

## Accepting Our Mistakes

Well, as I mentioned before, browsers' `Accept` headers used to be "bad". What
exactly is "bad"?

```
application/xml,application/xhtml+xml,text/html;q=0.9,text/plain;q=0.8,image/png,*/*;q=0.5
```

This was WebKit's `Accept` header back in 2010, meaning it was used by both
Safari and Chrome[^ie].

Notice the order of the content types: first `application/xml`, then
`application/xhtml+xml`, and only _then_ `text/html`. [RFC 9110][] (which
defines HTTP Semantics, including the `Accept` header) dictates that earlier
types in the list should be preferred over later ones. Therefore, if a web
server were to follow the spec, it would respond to requests from Safari and
Chrome with XML instead of HTML!

[RFC 9110]: https://www.rfc-editor.org/info/rfc9110/#name-accept

## We Don't Have to Accept This

While it can be used for other things, Rails is primarily a web application
framework that serves HTML webpages. So to provide a better "out of the box"
experience for developers, Rails should do _something_ to ensure that Safari and
Chrome aren't accidentally given XML pages when they most likely expect HTML.

The first approach taken by Rails was to just [ignore the `Accept`
header][use_accept] completely. Initially, this was going to be the default
behavior, but it was changed a few weeks later to be [opt-in][].

<!-- There was also small carve out for XHR requests, which would always be treated as `js`. -->

[use_accept]: https://github.com/rails/rails/commit/2f4aaed7b3feb3be787a316fab3144c06bb21a27
[opt-in]: https://github.com/rails/rails/commit/4ce9931f4f30045b2975328e7d42a02188e35079

A year later (as part of the Merb-ge?), the logic was [tweaked][] to be
"smarter". Why should non-browser clients have their `Accept` header ignored
just because browsers misbehave? The new version would respect a request's
`Accept` header if

- the request is `xhr?`[^xhr]
- or the `Accept` header only contains one value

[tweaked]: https://github.com/rails/rails/commit/1310231c15742bf7d99e2f143d88b383c32782d3

This was a big improvement because ignoring the `Accept` header was no longer an
absolute. However, a bug report was opened because `Accept` headers with
multiple values were now ignored unconditionally. In response, the logic was
[refined][] to only ignore the header if it contains the wildcard value (`*/*`).

[refined]: https://github.com/rails/rails/commit/dc5300adb6d46252c26e239ac67e3ca6e5e2d77b

And that logic has (mostly[^mostly]) persisted until today!

## Change is Hard to Accept

Well, now its 2026, and all of the major browsers send much more reasonable
`Accept` headers. Chrome and Safari were both fixed by the same [commit to
Webkit][] in 2011 which changed the default `Accept` header to match Firefox's,
which was much more reasonable:

[commit to Webkit]: https://commits.webkit.org/70664@main

```
text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
```

This commit landed in Chrome 12 and Safari 5.1, which were released in June and
July of 2011, a full 15 years ago!

It's time for Rails to go back to the spec, and that's exactly what the [pull
request][] I mentioned at the beginning of this post does: it adds a new
configuration so that applications can opt-in to exact RFC 9110 behavior (and
newly created applications are automatically opted-in).

---

[^ie]: If you're interested in seeing an even _worse_ `Accept` header, read
    [this blog post][] which also looks at Internet Explorer.

[^xhr]: If the `x-requested-with` header contains `XMLHttpRequest`, you can see
    the code [here][xhr-code]

[^mostly]: For completion's sake: initially the `*/*` only caused the `Accept`
    header to be ignored if it was at the end, and `*/*` in other positions was
    only added [later][wildcard-front], and then
    [improved][wildcard-front-spacing].

[this blog post]: https://www.newmediacampaigns.com/blog/browser-rest-http-accept-headers
[xhr-code]: https://github.com/rails/rails/blob/b7b58d3c65a52389b3e4dd56d64df5804ba7c71f/actionpack/lib/action_dispatch/http/request.rb#L298-L304
[wildcard-front]: https://github.com/rails/rails/commit/61950a4b05ce1b5640ac3f3720f9a3368ce95a29
[wildcard-front-spacing]: https://github.com/rails/rails/commit/eb6ccc9953a5e952737174995b5230f0b2c56b1f
