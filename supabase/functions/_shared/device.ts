const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isDeviceId = (value: string): boolean => UUID.test(value);

/**
 * The device header is deliberately checked by each write-capable function,
 * rather than trusting the app to hide its controls after a takeover. The RPC
 * also updates last_seen_at, but never resurrects an inactive device.
 */
export async function isActiveDevice(
  admin: { rpc: (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> },
  userId: string,
  deviceId: string,
): Promise<boolean> {
  if (!isDeviceId(deviceId)) return false;
  const { data, error } = await admin.rpc('assert_active_device', {
    p_user_id: userId,
    p_device_id: deviceId,
  });
  if (error) throw error;
  return data === true;
}
