---
title: "It's TRUE, SQL Supports Booleans"
---

When working on Rails applications, almost all of the queries I write use Active
Record.

```ruby
class Post
  scope :published, -> { where(published: true) }
end

Post.published.to_sql
# => "SELECT "posts".* FROM "posts" WHERE "posts"."published" = TRUE
```

However, sometimes queries are complex enough that they need to be written by
hand. This can make it difficult for an application to maintain one of the more
interesting benefits of using an ORM (Object-relational mapping): database
agnosticity.

Let's pretend the query above can't be written with standard Active Record and
needs to use some plain SQL. For MySQL, that may look like this:

```ruby
Post.where("published = 1").to_sql
# => SELECT `posts`.* FROM `posts` WHERE published = 1
```

There are two differences from the initial example: MySQL uses backticks by
default for quoting identifiers, and more importantly, this MySQL query compares
`published` with `1` instead of `TRUE`. If you try running this version of the
query with Postgres, you'll get an error!

## `BOOLEAN`s are not always `BOOLEAN`s

The `published = 1` query works with MySQL because MySQL doesn't actually have a
`BOOLEAN` column type. It does have `BOOL`/`BOOLEAN` aliases, but under the hood
those aliases refer to the column type `TINYINT(1)`. This is also generally the
case with SQLite, except SQLite maps `BOOLEAN` to its `INTEGER` type.

Since both of these databases use integers under the hood, both databases allow
querying "boolean" columns like `published = 1`. Unfortunately, this syntax
doesn't work with Postgres because it has a _real_ `BOOLEAN` type.

Additionally, there's another issue when comparing columns with `1` and `0`. How
does someone reading the query know if the column type is supposed to be a
boolean or an integer? Maybe the column name _sounds_ boolean (like
`published`), but maybe it's more ambiguous. By comparing a column with `TRUE`
or `FALSE`, future readers will immediately know that the column is boolean.

## Keep Things Compatible

So, if you have to write some plain SQL with a `BOOLEAN` column, use boolean
literals!

```ruby
Post.where("published = TRUE").to_sql
# => SELECT "posts".* FROM "posts" WHERE published = TRUE
```

This ensures your query will be compatible with Postgres, MySQL, and SQLite, and
it helps clarify the query's column types for future readers.
