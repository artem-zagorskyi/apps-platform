import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../errors.dart';
import 'models.dart';

/// Thin client for the platform server: HTTP and JSON only.
/// Knows nothing about storing or refreshing sessions.
class PlatformApi {
    PlatformApi({
    // Private named parameters: callers still pass baseUri: and client:
    required this._baseUri,
    required this._client,
    this.timeout = const Duration(seconds: 15),
  });
  
  final Uri _baseUri;
  final http.Client _client;
  final Duration timeout;

  Future<TokenPair> signUpAnonymous({
    required String appId,
    required String installationId,
    required DevicePlatform platform,
    required String appVersion,
    required String appBuild,
    required String osVersion,
  }) async {
    final json = await _send('POST', '/v1/auth/anonymous', body: {
      'appId': appId,
      'installationId': installationId,
      'platform': platform.name,
      'appVersion': appVersion,
      'appBuild': appBuild,
      'osVersion': osVersion,
    });
    return _parse(() => TokenPair.fromJson(json));
  }

  Future<TokenPair> refresh(String refreshToken) async {
    final json = await _send('POST', '/v1/auth/refresh', body: {
      'refreshToken': refreshToken,
    });
    return _parse(() => TokenPair.fromJson(json));
  }

  // Sends a request and returns the decoded JSON object of a 2xx response.
  // Every failure is turned into a AppPlatformException subtype.
  Future<Map<String, Object?>> _send(
    String method,
    String path, {
    Map<String, Object?>? body,
    String? accessToken,
  }) async {
    final request = http.Request(method, _resolve(path))
      ..headers['accept'] = 'application/json';

    if (accessToken != null) {
      request.headers['authorization'] = 'Bearer $accessToken';
    }
    // Only with a body: the server rejects an empty body declared as JSON
    if (body != null) {
      request.headers['content-type'] = 'application/json';
      request.body = jsonEncode(body);
    }

    final response = await _execute(request);
    final status = response.statusCode;
    final decoded = _tryDecodeObject(response.body);

    if (status >= 200 && status < 300) {
      if (decoded == null) {
        throw ServerException(statusCode: status, message: 'Malformed response body');
      }
      return decoded;
    }

    final code = decoded?['error'];
    final message = decoded?['message'];
    final text = message is String ? message : 'HTTP $status';

    if (status == 429 || status >= 500) {
      throw ServerException(statusCode: status, message: text);
    }
    throw ApiException(
      statusCode: status,
      code: code is String ? code : ApiErrorCode.unknown,
      message: text,
    );
  }

  Future<http.Response> _execute(http.Request request) async {
    try {
      final streamed = await _client.send(request).timeout(timeout);
      return await http.Response.fromStream(streamed).timeout(timeout);
    } on TimeoutException catch (e) {
      throw NetworkException('Request timed out', cause: e);
    } on http.ClientException catch (e) {
      throw NetworkException(e.message, cause: e);
    }
  }

  // Joins the base URL and an absolute API path, keeping any base path
  // (e.g. https://host/api + /v1/me -> https://host/api/v1/me)
  Uri _resolve(String path) {
    final basePath = _baseUri.path.endsWith('/')
        ? _baseUri.path.substring(0, _baseUri.path.length - 1)
        : _baseUri.path;
    return _baseUri.replace(path: '$basePath$path');
  }

  static Map<String, Object?>? _tryDecodeObject(String body) {
    if (body.isEmpty) return null;
    try {
      final value = jsonDecode(body);
      return value is Map<String, Object?> ? value : null;
    } on FormatException {
      return null;
    }
  }

  // A 2xx response with an unexpected shape is a server bug, not a client error
  static T _parse<T>(T Function() parse) {
    try {
      return parse();
    } on FormatException catch (e) {
      throw ServerException(statusCode: 200, message: 'Malformed response: ${e.message}');
    }
  }
}