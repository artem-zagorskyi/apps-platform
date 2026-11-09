'use client';

import { useState } from 'react';
import { ActionForm } from '@/components/action-form';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

const PLATFORM_LABELS = { android: 'Android', ios: 'iOS' };
const PLACEHOLDERS = {
  google: '1234567890-abc123.apps.googleusercontent.com',
  apple: 'com.example.app',
};

// platforms: the platforms registered for the app, e.g. ['android', 'ios']
export function AddClientForm({ action, platforms }) {
  const [provider, setProvider] = useState('google');
  const [platform, setPlatform] = useState(platforms[0]);

  // Sign in with Apple is offered on iOS only
  const choices = provider === 'apple' ? platforms.filter((item) => item === 'ios') : platforms;
  const selected = choices.includes(platform) ? platform : choices[0];

  return (
    <ActionForm action={action} submitLabel="Add client" successMessage="Client added" inline>
      <div className="flex gap-2">
        <Select
          name="provider"
          aria-label="Provider"
          value={provider}
          onValueChange={setProvider}
          items={[
            { value: 'google', label: 'Google' },
            { value: 'apple', label: 'Apple', disabled: !platforms.includes('ios') },
          ]}
          triggerClassName="h-8 w-[6.5rem] justify-between"
        />
        <Select
          name="platform"
          aria-label="Platform"
          value={selected}
          onValueChange={setPlatform}
          items={choices.map((item) => ({ value: item, label: PLATFORM_LABELS[item] }))}
          triggerClassName="h-8 w-[6.5rem] justify-between"
        />
        <Input
          name="clientId"
          aria-label="Client ID"
          placeholder={PLACEHOLDERS[provider]}
          mono
          required
          maxLength={255}
          className="min-w-0 flex-1"
        />
      </div>
    </ActionForm>
  );
}