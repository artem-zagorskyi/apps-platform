'use client';

import { useEffect, useState } from 'react';

function format(value, timeZone) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
    new Date(value),
  );
}

// A moment in the admin's own time zone. The server does not know it, so
// the first render shows UTC and the browser replaces it right away.
export function Time({ value }) {
  const [text, setText] = useState(() => `${format(value, 'UTC')} UTC`);

  useEffect(() => {
    setText(format(value));
  }, [value]);

  return <time dateTime={new Date(value).toISOString()}>{text}</time>;
}