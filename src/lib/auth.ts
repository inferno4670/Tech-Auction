import { supabase } from './supabase';
import type { Profile } from '../types';

export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error || !data) return null;
  return data as Profile;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getTeamForUser(userId: string) {
  const { data, error } = await supabase
    .from('team_members')
    .select('team_id, teams(*)')
    .eq('user_id', userId)
    .single();

  if (error || !data) return null;
  return data.teams as any;
}

export function isAdmin(profile: Profile | null): boolean {
  return profile?.role === 'admin';
}

export function isTeam(profile: Profile | null): boolean {
  return profile?.role === 'team';
}
