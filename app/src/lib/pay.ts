import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { API_URL } from './api';

/**
 * Opens our secure payment page (Razorpay checkout inside) in an in-app browser and waits until it sends the member
 * back. The page never decides "paid" by itself: the app re-reads the booking from our server afterwards.
 */
export async function openPayment(ref: string) {
  const back = Platform.OS === 'web' ? `${location.origin}/ticket/${ref}` : Linking.createURL('payment');
  await WebBrowser.openAuthSessionAsync(`${API_URL}/pay/${ref}?return=${encodeURIComponent(back)}`, back);
}
