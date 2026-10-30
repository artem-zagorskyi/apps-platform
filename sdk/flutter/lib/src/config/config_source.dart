/// Where generated config code reads values from. Every read falls back to
/// the built-in default when there is no value or this app version cannot
/// use it (wrong type, out of its range, unknown enum value).
abstract interface class ConfigSource {
  bool readBool(String name, {required bool defaultValue});

  int readInt(String name, {required int defaultValue, int? min, int? max});

  double readNumber(String name, {required double defaultValue, double? min, double? max});

  String readString(String name, {required String defaultValue, required int maxLength});

  /// Returns one of [values]
  String readEnum(String name, {required String defaultValue, required List<String> values});
}

/// Fixed values with the app's own checks. The SDK keeps the server's values
/// in it; app tests can use it directly:
/// `AppConfig(const ConfigValues({'ads_enabled': false}))`.
class ConfigValues implements ConfigSource {
  const ConfigValues(this._values);

  static const empty = ConfigValues({});

  final Map<String, Object?> _values;

  /// Raw value from the server, without checks
  Object? operator [](String name) => _values[name];

  @override
  bool readBool(String name, {required bool defaultValue}) => switch (_values[name]) {
        final bool value => value,
        _ => defaultValue,
      };

  @override
  int readInt(String name, {required int defaultValue, int? min, int? max}) => switch (_values[name]) {
        final int value when _inRange(value, min, max) => value,
        _ => defaultValue,
      };

  @override
  double readNumber(String name, {required double defaultValue, double? min, double? max}) =>
      switch (_values[name]) {
        final num value when value.isFinite && _inRange(value, min, max) => value.toDouble(),
        _ => defaultValue,
      };

  @override
  String readString(String name, {required String defaultValue, required int maxLength}) =>
      switch (_values[name]) {
        final String value when value.length <= maxLength => value,
        _ => defaultValue,
      };

  @override
  String readEnum(String name, {required String defaultValue, required List<String> values}) =>
      switch (_values[name]) {
        final String value when values.contains(value) => value,
        _ => defaultValue,
      };

  static bool _inRange(num value, num? min, num? max) =>
      (min == null || value >= min) && (max == null || value <= max);
}