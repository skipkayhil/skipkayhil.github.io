---
title: "The Mysterious MySQL Collation"
---

After upgrading a Rails application's development database from MySQL 5.7 to
MySQL 8.0, I ran into a weird behavior with the application's `schema.rb`.
Whenever I ran a new migration locally, a `collation: "utf8mb4_0900_ai_ci"`
option would be added to all of the `create_table`s in the `schema.rb` even
though the migration did not touch these tables.

I also knew that the production database did _not_ use this collation for its
tables, so I didn't want to commit the newly added `collation:` option. However,
manually modifying the `schema.rb` to remove these additions after every
migration run would be a ton of toil, so I needed to figure out _why_ these
changes were happening and what the correct `schema.rb` _should_ be.

## The Why

It turns out that this was caused by two semi-related changes in MySQL.

First, the default collation for the `utf8mb4` charset was changed from
`utf8mb4_general_ci` to `utf8mb4_0900_ai_ci` in MySQL 8.0.1. I knew about this
change, and it explains why the dumped `collation` value is `utf8mb4_0900_ai_ci`
(since the development database was created without specifying a collation, it
used the default).

The more interesting change came specifically in MySQL 8.0.11.

The first thing to know is that Rails [parses the output][1] of the `SHOW CREATE
TABLE` [query][2] when [dumping `create_table`][3] in the `schema.rb` file. And
before MySQL 8.0.11, `SHOW CREATE TABLE` would not include a table's collation
if it matched the default collation for the table's charset. That behavior
changed in [MySQL 8.0.11][], and now `SHOW CREATE TABLE` will _always_ include a
table's collation even if it matches the default.

[1]: https://github.com/rails/rails/blob/a72205eaf8cff4b36838c49b00ae10f9e72dbb95/activerecord/lib/active_record/connection_adapters/abstract_mysql_adapter.rb#L588
[2]: https://github.com/rails/rails/blob/a72205eaf8cff4b36838c49b00ae10f9e72dbb95/activerecord/lib/active_record/connection_adapters/abstract_mysql_adapter.rb#L995
[3]: https://github.com/rails/rails/blob/a72205eaf8cff4b36838c49b00ae10f9e72dbb95/activerecord/lib/active_record/schema_dumper.rb#L189
[MySQL 8.0.11]: https://bugs.mysql.com/bug.php?id=46239

So to reiterate, the `collation:` option is added to the `schema.rb` because of
the new `SHOW CREATE TABLE` output, and the `collation:` value is
`utf8mb4_0900_ai_ci` because it became the default collation for the `utf8mb4`
charset.

## The Fix

Now I've identified why the `schema.rb` is changing, and that _some_ change is
expected, but what change should I actually commit?

While I could accept the new default of `utf8mb4_0900_ai_ci`, the production
database is not using this collation (and there are no plans to change that). So
the appropriate fix in this case is making the `schema.rb` in development match
the state of the real database schema in production.

To get the collation of tables in production, I ran this query

```sql
SELECT table_name, table_collation
FROM information_schema.tables
WHERE table_schema = 'my-app-production';
```

which gave a result like

```mysql
+------------+--------------------+
| TABLE_NAME | TABLE_COLLATION    |
+------------+--------------------+
| comments   | utf8mb4_unicode_ci |
| posts      | utf8mb4_unicode_ci |
+------------+--------------------+
```

Interestingly, all of the tables' collations are set to `utf8mb4_unicode_ci`,
which was not the default for the `utf8mb4` charset in MySQL 5.7, so I confirmed
that the database is configured to use this other collation by default

```sql
SELECT default_collation_name
FROM information_schema.SCHEMATA
WHERE schema_name = 'my-app-production';
```

```mysql
+------------------------+
| DEFAULT_COLLATION_NAME |
+------------------------+
| utf8mb4_unicode_ci     |
+------------------------+
```

To make development match production, `collation: utf8mb4_unicode_ci` should be
set on all of the tables currently in the `schema.rb` as well as all future
tables that don't specify a different collation.

The default collation can be changed in development by adding configuration to
`config/database.yml`

```diff
diff --git a/config/database.yml b/config/database.yml
index 4fed673..fb7ca18 100644
--- a/config/database.yml
+++ b/config/database.yml
@@ -12,6 +12,7 @@
 default: &default
   adapter: trilogy
   encoding: utf8mb4
+  collation: utf8mb4_unicode_ci
   pool: <%= ENV.fetch("RAILS_MAX_THREADS") { 5 } %>
   username: root
   password:
```

in this case I put the configuration in the `&default` anchor so that all
environments are identical.

The last thing to do is fix the `schema.rb` by re-running all migrations with
the new default collation

```shell
$ bin/rails db:reset
```

> In Rails 8+ it would be `bin/rails db:migrate:reset` because `db:reset` will
> do `db:schema:load` before running migrations, but I specifically want all
> migrations to be run on an empty database so that all of the tables are
> recreated.

Now I can finally commit the updated `schema.rb` with `collation:
utf8mb4_unicode_ci` added to all of the `create_table` statements, and if I run
a new migration there won't be any extraneous collation changes 🎉
