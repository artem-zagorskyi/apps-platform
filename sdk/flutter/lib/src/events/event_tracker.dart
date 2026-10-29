/// Whether an event is recorded without analytics consent.
enum EventCategory {
  /// Needed to operate the app or the business (e.g. purchases): always recorded
  essential,

  /// Behaviour: recorded only with analytics consent
  analytics,
}

/// Receives events from generated tracking code. The SDK implements it;
/// apps call the generated functions, not this interface.
abstract interface class EventTracker {
  void track(String name, EventCategory category, Map<String, Object?> properties);
}