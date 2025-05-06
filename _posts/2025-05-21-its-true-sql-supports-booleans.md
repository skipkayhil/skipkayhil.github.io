---
title: "It's TRUE, SQL Supports Booleans"
canonical_url: https://railsatscale.com/2025-05-21-it-s-true-sql-supports-booleans/
---

*Originally published on [Rails At Scale]({{ page.canonical_url }})*

When working on Rails applications, almost all of the queries I write use Active
Record.

```ruby
class Post
  scope :published, -> { where(published: true) }
end

Post.published.to_sql
# => SELECT "posts".* FROM "posts" WHERE "posts"."published" = TRUE
```

However, sometimes queries are complex enough that they need to be written by
hand. This can make it difficult for an application to maintain one of the more
interesting benefits of using an ORM (Object-Relational Mapping): database
agnosticism.

Let's pretend the query above can't be written with standard Active Record and
needs to use some plain SQL. For MySQL, that may look like this:

```ruby
Post.where("published = 1").to_sql
# => SELECT `posts`.* FROM `posts` WHERE published = 1
```

There are two differences from the initial example: MySQL uses backticks for
quoting identifiers, and more importantly, this MySQL query compares `published`
with `1` instead of `TRUE`. If you try running this version of the query with
Postgres, you'll get an error!

```
PG::UndefinedFunction: ERROR:  operator does not exist: boolean = integer (ActiveRecord::StatementInvalid)
LINE 1: SELECT "posts".* FROM "posts" WHERE (published = 1) /*applic...
```

## `BOOLEANS` are not always `BOOLEANS`

The `published = 1` query works with MySQL because MySQL doesn't actually have a
`BOOLEAN` column type. It does have `BOOL`/`BOOLEAN` aliases, but under the hood
those aliases refer to the column type `TINYINT(1)`. This is also generally the
case with SQLite, except SQLite maps `BOOLEAN` to its `INTEGER` type.

Since both of these databases use integers under the hood, both databases allow
querying "boolean" columns like `published = 1`. Unfortunately, this syntax
doesn't work with Postgres because it has a _real_ `BOOLEAN` type. This means in
Postgres, you _must_ compare `BOOLEAN` columns with `TRUE` or `FALSE`.

Fortunately, `TRUE` and `FALSE` actually work with MySQL and SQLite[^1] as well.
Just like `BOOLEAN` is an alias for an integer column type in MySQL and SQLite,
`TRUE` is an alias for `1` and `FALSE` is an alias for `0`. This means if you
want to write a query that works with all three databases, you should always use
`TRUE` and `FALSE` when comparing `BOOLEAN` columns.

Additionally, there's another benefit to using `TRUE` and `FALSE` instead of `1`
and `0`. How does someone reading a query using `1` or `0` know if the column
type is supposed to be a boolean or an integer? Maybe the column name _sounds_
boolean (like `published`), but maybe it's more ambiguous. By comparing a column
with `TRUE` or `FALSE`, future readers will immediately know that the column is
boolean.

## Keep Things Compatible

So, if you have to write some plain SQL with a `BOOLEAN` column, use boolean
literals!

```ruby
Post.where("published = TRUE").to_sql
# => SELECT "posts".* FROM "posts" WHERE published = TRUE
```

This ensures your query will be compatible with Postgres, MySQL, and SQLite, and
it helps clarify the query's column types for future readers.

---

[^1]: SQLite didn't add the `TRUE` and `FALSE` aliases until version 3.23.0, so,
    to be compatible with older versions, Active Record 8.0 and below generate
    queries for SQLite with `1` and `0`. However, the [minimum supported
    version][] of SQLite will be 3.23.0 starting in Active Record 8.1 so that
    Active Record can use `TRUE` and `FALSE` for both [Arel][] and [standard
    Active Record][] queries.

[minimum supported version]: https://github.com/rails/rails/commit/809abd3ed3c7700bae1edf104c0ad61acb638d4b
[Arel]: https://github.com/rails/rails/commit/34bebf383e18243a1cdadc461e3a84c66125cb9b
[standard Active Record]: https://github.com/rails/rails/commit/576db3bbd4446a59f46a2d7d2b2afa78898d2fd8
