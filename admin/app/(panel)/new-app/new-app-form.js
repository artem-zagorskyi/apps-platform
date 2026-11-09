'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

// "Habit Tracker" -> "habit-tracker", within the server's slug rules:
// lowercase letters, digits and dashes, starts with a letter, at most 40 long
function toSlug(name) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

export function NewAppForm({ action }) {
  const [state, formAction, pending] = useActionState(action, null);
  const [name, setName] = useState('');
  // The slug follows the name until the admin edits it by hand
  const [customSlug, setCustomSlug] = useState(null);
  const slug = customSlug ?? toSlug(name);

  return (
    <form action={formAction}>
      <Card>
        <CardHeader
          title="Create an app"
          description="Platforms, sign-in and the rest are set up on the app's settings right after."
        />
        <CardBody className="flex flex-col gap-4">
          <Field label="Name" description="Shown in the admin panel. Can be changed later.">
            <Input
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={80}
              autoFocus
              disabled={pending}
            />
          </Field>
          <Field
            label="Slug"
            description="Lowercase letters, digits and dashes, 3 to 40 long. Used in URLs and scripts; cannot be changed later."
            error={state?.error}
          >
            <Input
              name="slug"
              mono
              value={slug}
              onChange={(event) => setCustomSlug(event.target.value)}
              placeholder="habit-tracker"
              required
              minLength={3}
              maxLength={40}
              disabled={pending}
            />
          </Field>
        </CardBody>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {pending ? 'Creating…' : 'Create app'}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}