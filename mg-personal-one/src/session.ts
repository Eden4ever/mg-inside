import { ref } from 'vue';
import { request, type SessionUser } from './api/client';
export const user = ref<SessionUser | null>(null);
export async function loadSession() { user.value = (await request<{ user: SessionUser }>('/auth/me')).user; }
