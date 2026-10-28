import 'package:flutter_test/flutter_test.dart';
import 'package:renvix_sdk/src/storage/session_store.dart';

void main() {
  late InMemoryKeyValueStore raw;
  late SessionStore store;

  final session = StoredSession(
    userId: 'user-1',
    refreshToken: 'refresh-1',
    refreshTokenExpiresAt: DateTime.utc(2027, 1, 24, 19, 30),
  );

  setUp(() {
    raw = InMemoryKeyValueStore();
    store = SessionStore(raw);
  });

  test('returns null when nothing is stored', () async {
    expect(await store.readInstallationId(), isNull);
    expect(await store.readSession(), isNull);
  });

  test('round-trips the session', () async {
    await store.writeSession(session);

    final read = await store.readSession();

    expect(read?.userId, 'user-1');
    expect(read?.refreshToken, 'refresh-1');
    expect(read?.refreshTokenExpiresAt, DateTime.utc(2027, 1, 24, 19, 30));
  });

  test('clearing the session keeps the installation id', () async {
    await store.writeInstallationId('install-1');
    await store.writeSession(session);

    await store.clearSession();

    expect(await store.readSession(), isNull);
    expect(await store.readInstallationId(), 'install-1');
  });

  test('treats an unreadable session as missing', () async {
    await raw.write('app_platform.session', '{"userId": 42}');

    expect(await store.readSession(), isNull);
  });
}