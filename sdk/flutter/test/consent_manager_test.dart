import 'package:flutter_test/flutter_test.dart';
import 'package:renvix_sdk/renvix_sdk.dart';
import 'package:renvix_sdk/src/api/models.dart';
import 'package:renvix_sdk/src/consent/consent_store.dart';
import 'package:renvix_sdk/src/session/session_manager.dart';
import 'package:renvix_sdk/src/storage/session_store.dart';

import 'support/fake_api.dart';

const _offline = NetworkException('offline');

Future<void> _flush() => Future<void>.delayed(Duration.zero);

void main() {
  late DateTime now;
  late FakeApi api;
  late InMemoryKeyValueStore storage;
  late SessionManager session;
  late ConsentManager consent;

  setUp(() {
    now = DateTime.utc(2026, 10, 29, 12);
    api = FakeApi(() => now);
    storage = InMemoryKeyValueStore();
    session = SessionManager(
      api: api,
      store: SessionStore(storage),
      client: testClient,
      clock: () => now,
      newInstallationId: () => 'install-1',
    );
  });

  Future<ConsentManager> createConsent() async {
    final manager = ConsentManager(
      session: session,
      api: api,
      store: ConsentStore(storage),
      clock: () => now,
    );
    await manager.load();
    return manager;
  }

  // An online device that has already asked the server once
  Future<void> startOnline() async {
    await session.start();
    consent = await createConsent();
    await consent.sync();
  }

  ConsentState state() => consent.state.value;

  test('a new user has to decide and nothing is allowed yet', () async {
    await startOnline();

    expect(state().status, ConsentStatus.needsDecision);
    expect(state().analytics, isFalse);
    expect(state().personalization, isFalse);
    expect(state().policyVersion, 'v1');
  });

  test('a decision applies at once and reaches the server', () async {
    await startOnline();

    await consent.record(analytics: true, personalization: false, source: ConsentSource.firstLaunch);

    // Before the server answers
    expect(state().status, ConsentStatus.decided);
    expect(state().analytics, isTrue);
    expect(state().personalization, isFalse);

    await consent.sync();
    final record = api.consentRecords.single;
    expect(record.userId, 'user-1');
    expect(record.policyVersion, 'v1');
    expect(record.source, ConsentSource.firstLaunch);
  });

  test('offline, a decision holds and is sent later', () async {
    await startOnline();
    api.consentFailure = _offline;

    await consent.record(analytics: true, personalization: true, source: ConsentSource.firstLaunch);
    await _flush();

    expect(state().analytics, isTrue);
    expect(api.consentRecords, isEmpty);

    api.consentFailure = null;
    await consent.sync();

    expect(api.consentRecords, hasLength(1));
    expect(state().status, ConsentStatus.decided);
  });

  test('decisions survive a restart', () async {
    await startOnline();
    await consent.record(analytics: true, personalization: true, source: ConsentSource.firstLaunch);
    await consent.sync();
    await consent.dispose();

    final restarted = await createConsent();

    expect(restarted.state.value.status, ConsentStatus.decided);
    expect(restarted.state.value.analytics, isTrue);
  });

  test('a new policy version asks again and keeps the previous choice meanwhile', () async {
    await startOnline();
    await consent.record(analytics: true, personalization: true, source: ConsentSource.firstLaunch);
    await consent.sync();

    api.consentPolicyVersion = 'v2';
    await consent.sync();

    expect(state().status, ConsentStatus.needsDecision);
    expect(state().analytics, isTrue);
  });

  test('without a consent screen analytics is on until switched off', () async {
    api.consentMode = ConsentMode.none;
    await startOnline();

    expect(state().status, ConsentStatus.notRequired);
    expect(state().analytics, isTrue);

    await consent.record(analytics: false, source: ConsentSource.settings);

    expect(state().status, ConsentStatus.notRequired);
    expect(state().analytics, isFalse);
  });

  test('after logout the new user is asked again', () async {
    await startOnline();
    await consent.record(analytics: true, personalization: true, source: ConsentSource.firstLaunch);
    await consent.sync();

    await session.applyTokens(api.issue('user-2'), UserChangeReason.loggedOut);
    await _flush();
    await consent.sync();

    expect(state().status, ConsentStatus.needsDecision);
    expect(state().analytics, isFalse);
  });

  test("after a merge the account's own decisions apply", () async {
    await startOnline();
    api.setServerConsent('user-9', {
      ConsentPurpose.analytics: false,
      ConsentPurpose.personalization: true,
    });

    await session.applyTokens(api.issue('user-9'), UserChangeReason.merged);
    await _flush();
    await consent.sync();

    expect(state().status, ConsentStatus.decided);
    expect(state().analytics, isFalse);
    expect(state().personalization, isTrue);
  });

  test('a decision made before the user existed is sent once the user is created', () async {
    api.onSignUp = (_) async => throw _offline;
    await session.start();
    consent = await createConsent();

    await consent.record(analytics: true, personalization: true, source: ConsentSource.firstLaunch);
    await _flush();
    expect(state().status, ConsentStatus.decided);

    api.onSignUp = null;
    await consent.sync();
    await _flush();

    final record = api.consentRecords.single;
    expect(record.userId, 'user-1');
    // The policy was unknown when deciding: the current one applies
    expect(record.policyVersion, 'v1');
  });
}