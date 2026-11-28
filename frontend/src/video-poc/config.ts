export const supabaseUrl = import.meta.env.VITE_VIDEO_POC_SUPABASE_URL as string | undefined;
export const publishableKey = import.meta.env.VITE_VIDEO_POC_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const videoLabEnabled = !!(supabaseUrl && publishableKey);
