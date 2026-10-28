package com.renvix.renvix_sdk

import android.app.Activity
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Native part of the SDK on Android.
 * Google sign-in through Credential Manager with a nonce issued by the
 * platform server for every attempt.
 */
class AppPlatformPlugin : FlutterPlugin, MethodChannel.MethodCallHandler, ActivityAware {
    private var channel: MethodChannel? = null
    private var scope: CoroutineScope? = null

    // The account chooser is UI, so it needs the current activity
    private var activity: Activity? = null

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
        channel = MethodChannel(binding.binaryMessenger, CHANNEL).also {
            it.setMethodCallHandler(this)
        }
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        channel?.setMethodCallHandler(null)
        channel = null
        scope?.cancel()
        scope = null
    }

    override fun onAttachedToActivity(binding: ActivityPluginBinding) {
        activity = binding.activity
    }

    override fun onDetachedFromActivityForConfigChanges() {
        activity = null
    }

    override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) {
        activity = binding.activity
    }

    override fun onDetachedFromActivity() {
        activity = null
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "requestGoogleIdToken" -> requestGoogleIdToken(call, result)
            else -> result.notImplemented()
        }
    }

    private fun requestGoogleIdToken(call: MethodCall, result: MethodChannel.Result) {
        val serverClientId = call.argument<String>("serverClientId")
        val nonce = call.argument<String>("nonce")
        val currentActivity = activity
        val currentScope = scope

        if (serverClientId.isNullOrEmpty() || nonce.isNullOrEmpty()) {
            result.error("invalid_arguments", "serverClientId and nonce are required", null)
            return
        }
        if (currentActivity == null || currentScope == null) {
            result.error("no_activity", "Google sign-in needs a foreground activity", null)
            return
        }

        // Button flow: shows every Google account on the device, including
        // ones never used with this app. The nonce ends up in the ID token.
        val option = GetSignInWithGoogleOption.Builder(serverClientId)
            .setNonce(nonce)
            .build()
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(option)
            .build()

        currentScope.launch {
            try {
                val response = CredentialManager.create(currentActivity)
                    .getCredential(currentActivity, request)
                val credential = response.credential

                if (credential is CustomCredential &&
                    credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
                ) {
                    result.success(GoogleIdTokenCredential.createFrom(credential.data).idToken)
                } else {
                    result.error("unexpected_credential", "Unexpected credential type: ${credential.type}", null)
                }
            } catch (e: GetCredentialCancellationException) {
                // The person closed the chooser
                result.success(null)
            } catch (e: NoCredentialException) {
                result.error("no_google_account", e.message ?: "No Google account on this device", null)
            } catch (e: GetCredentialException) {
                result.error("credential_error", "${e.type}: ${e.message}", null)
            } catch (e: GoogleIdTokenParsingException) {
                result.error("invalid_token", e.message ?: "Could not read the Google ID token", null)
            }
        }
    }

    private companion object {
        const val CHANNEL = "app_platform/google_sign_in"
    }
}