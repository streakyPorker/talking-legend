import { z } from 'zod';
export const talkToNpcSchema = z.object({ message: z.string().min(1) });
export type TalkToNpcRequest = z.infer<typeof talkToNpcSchema>;
