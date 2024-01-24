---
title: "It's time to stop changing data in Active Record Migrations"
---

A change in Rails 7.1 caused an old migration of mine to raise an error. This
isn't the first time it has happened, and I'm sure it won't be the last. As
someone who has [put][] in [work][] to [ensure][] that old Rails migrations
[continue][] to [keep][] working [eternally][], I can tell you it isn't an easy
task. But this error was different than others I had seen: the migration wasn't
making any changes to the schema; it was migrating data.

[put]: https://github.com/rails/rails/commit/327f28b65f438208443632d5da5cdd2aaa9d9464
[work]: https://github.com/rails/rails/commit/71b4e223018d180b7c96915c0df1c28afbf7cc53
[ensure]: https://github.com/rails/rails/commit/c793cdc665b035d2f3dc2a8c332df841cf9b0f59
[continue]: https://github.com/rails/rails/commit/9b07b2d6ca2ee9854cd986da0bf914b9ace9d547
[keep]: https://github.com/rails/rails/commit/c2f838e80c76c9a3407e1e7af1ecbd738511fd72
[eternally]: https://github.com/rails/rails/commit/16f8bd79444a512dfebf2d77bd2fd3075041475b

## Moving data south for the winter?

Active Record Migrations are the set of tools Rails provides to make changes to
an application's database. A migration is written in a Ruby file using a Domain
Specific Language, and then run using the `rails` Command Line Interface.
Generally that means running `rails db:migrate`, which will execute all
migrations that have yet to run against the database.

After a migration has run, Rails also dumps the current state of the database in
a file (usually `db/schema.rb`) which uses the same migration DSL. Developers
can then setup new databases with the `rails db:schema:load` command to load
just that file instead of having to run every single migration from the
beginning.

## Got it, changing the database

When Active Record migrations are used to make changes to the database schema,
everything works great. Since the DSL is a relatively thin wrapper over SQL
statements, migrations don't have to worry about any application code. However,
things start to get more complicated when developers try to use migrations to
modify the actual data in the database, which is also known as a data migration.

Schema migrations and data migrations _feel_ like they should go together right?
For example, say a new column is being added to a table and existing rows in
that table will need that column populated. Since the column is being added in a
migration, why not put the code to populate the column right next to it?

This is exactly the pattern I'm here to advocate against.

**Migrations should only be used to make schema changes**.

## The Error

In my case, the error I ran into was this:

```
Undeclared attribute type for enum 'blah'. Enums must be backed by a database
column or declared with an explicit type via `attribute`.
```

Rails 7.1 added a new check to ensure that an Active Record `enum` is either
[backed by a column in the database][] or has an [explicitly specified type][].
The goal of these changes was to make `enum` resistant to typos, since
previously misspelling the name of the `enum` would just silently not work as
expected.

[backed by a column in the database]: https://github.com/rails/rails/commit/6c5fab0668c1872fe827507f45ef400a20e8c646
[explicitly specified type]: https://github.com/rails/rails/commit/6d00605f955a992fb52d4a1006f7c50b99a2e858

Of course, this new check can also cause problems when a model with an `enum`
attribute is used in a migration. Let's look at the following series of
migrations:

```ruby
class AddPosts < ActiveRecord::Migration[7.1]
  def change
    create_table :posts do |t|
    end
  end
end

class BackfillPosts < ActiveRecord::Migration[7.1]
  def change
    Post.find_each do |post|
      # modify the post
    end
  end
end

class AddStatusToPosts < ActiveRecord::Migration[7.1]
  def change
    add_column :posts, :status, :string, default: "draft"
  end
end
```

In the first migration, a table is created for a Post model. In the second, a
data migration is performed on the rows of the table. And in the third
migration, a new `status` column is added to the table. After running the third
migration in production, a developer adds `enum :status` to the model to take
advantage of the new column:

```ruby
class Post < ApplicationRecord
  enum :status, { draft: "draft", published: "published" }, default: :draft
end
```

After adding the `enum`, the second migration now errors because the column that
should be backing the `enum` isn't added until the next migration!

## A pattern emerges

Looking at this problem in isolation, it certainly could be viewed as a bug in
Rails, or at least something to consider supporting. However, this is just one
specific instance of a much larger problem. Using the same migrations from
before, but with a slightly different model:

```ruby
class Post < ApplicationRecord
  validates :status, presence: true
end
```

A different error is raised when running the second migration:

```
NoMethodError: undefined method `status' for an instance of Post
```

How about another series of migrations but with an empty Post class:

```ruby
class AddPosts < ActiveRecord::Migration[7.1]
  def change
    create_table :posts do |t|
    end

    up_only do
      10.times { Post.create! } 
    end
  end
end

class AddStatusToPosts < ActiveRecord::Migration[7.1]
  def change
    add_column :posts, :status, :string

    Post.find_each do
      post.update!(status: "published")
    end
  end
end
```

Can you spot the error?

I'll give you a hint: it involves the schema cache.

After running these migrations, it would be reasonable to expect that there are
now 10 Posts and all of them have a `status` of `"published"`. However, that is
not what actually happens.

When the first migration adds 10 Posts to the database, Active Record will
execute a query to fetch the list of columns for the Post model and store that
list in the schema cache. Keeping the list cached in memory ensures that it
doesn't have to make the same query again in the future. The list of columns is
then used to generate the queries to insert 10 Posts into the `posts` table.

When the second migration runs, the `status` column is added to the database,
but the schema cache is not cleared. So when the migration next tries to update
the `status` column for existing Posts, Active Record doesn't recognize `status`
as a database column and the existing Posts are not updated.

## Fundamental Incompatibilities

In all three of these cases, there are two conflicting concepts that cause
problems when used together:

On one side are migrations, which are meant to operate on the database _at a
certain point in time_.

On the other side are the Active Record models, which are meant to operate _only
on the current state_ of the database.

These two ideas are fundamentally at odds, and no amount of tricks or
workarounds can really address that. Naturally, there are likely many
exceptional cases where people have and will continue to successfully make these
two things work together. But instead of hoping and hacking, we can do something
quite simple to avoid the problem altogether: **do not make data changes in
migrations**.

## What _should_ I be doing?

With a disclaimer that I work at Shopify, my favorite library to perform data
migrations is [`maintenance_tasks`][]. A Maintenance Task is really just an
Active Job with some additional features, like the ability to interrupt/resume
long running jobs and a simple UI to kick off jobs and track progress.

[`maintenance_tasks`]: https://github.com/Shopify/maintenance_tasks

While I think the additional features are great, a separate library is not
strictly necessary to separate data migrations from Active Record migrations.
Creating a regular old Active Job and a way to enqueue it is probably plenty for
the majority of cases.

## Flying back north...

When an application is small, it can feel really tempting to reach for Active
Record migrations to make sweeping data changes. It's quick, dirty, and gets the
job done at the time. But as an application evolves with age, this behavior is
always a mistake and will come back to bite. It's time to stop changing data in
Active Record Migrations.
