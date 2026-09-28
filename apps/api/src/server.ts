import { z } from 'zod';
import { createApp } from './app';

const port = z.coerce.number().int().min(1).max(65535).default(3001).parse(process.env.PORT);

createApp().listen(port, () => {
  console.log(`api listening on http://localhost:${port}`);
});
