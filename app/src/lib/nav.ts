import { router } from 'expo-router';

/** Back if there is a previous screen; otherwise (opened from a link) go Home. */
export const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));
