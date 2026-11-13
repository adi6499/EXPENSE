package com.adi6499.expenses

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Telephony
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * Bank text messages. The phone side only fetches messages and shows notifications; working out
 * what a message means (amount, payee, category) is done by the web app in js/sms.js.
 */
object BankSms {
    private const val PREFS = "bank_sms"
    private const val CHANNEL = "bank_sms"
    private const val NOTIFICATION_ID = 2
    private const val MAX_MESSAGES = 1500
    private const val MAX_SCANNED = 20000

    // Only messages that mention an amount are handed to the web app
    private val MONEY = Regex("(?i)(₹|\\brs\\.?|\\binr)\\s*:?\\s*[0-9]|\\b(debited|credited)\\b")

    fun status(context: Context): String {
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)) return "unavailable"
        return if (isGranted(context)) "granted" else "denied"
    }

    fun isGranted(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED

    fun saveOptions(context: Context, enabled: Boolean, notify: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean("enabled", enabled)
            .putBoolean("notify", notify)
            .apply()
    }

    fun isEnabled(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("enabled", false)

    private fun wantsNotifications(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("notify", false)

    /** Inbox messages received after [since] (ms) that mention money, oldest first. */
    fun read(context: Context, since: Long): JSONArray {
        val found = ArrayList<JSONObject>()
        val cursor = context.contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI,
            arrayOf(Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE),
            "${Telephony.Sms.DATE} > ?",
            arrayOf(since.toString()),
            "${Telephony.Sms.DATE} DESC"
        ) ?: return JSONArray()
        cursor.use { c ->
            val idCol = c.getColumnIndexOrThrow(Telephony.Sms._ID)
            val addressCol = c.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
            val bodyCol = c.getColumnIndexOrThrow(Telephony.Sms.BODY)
            val dateCol = c.getColumnIndexOrThrow(Telephony.Sms.DATE)
            var scanned = 0
            while (c.moveToNext() && found.size < MAX_MESSAGES && scanned < MAX_SCANNED) {
                scanned++
                val body = c.getString(bodyCol) ?: continue
                if (!MONEY.containsMatchIn(body)) continue
                found.add(
                    JSONObject()
                        .put("id", c.getLong(idCol).toString())
                        .put("address", c.getString(addressCol) ?: "")
                        .put("body", body.take(1000))
                        .put("date", c.getLong(dateCol))
                )
            }
        }
        return JSONArray(found.asReversed())
    }

    // ---- A quick look at a new message, just enough for the notification's title

    private val AMOUNT = Regex("(?i)(?:₹|\\b(?:rs|inr)(?![a-z])\\.?)\\s*:?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)")
    private val BARE_AMOUNT = Regex("(?i)\\b(?:debited|credited)\\s+(?:by|for|with|of)\\s+([0-9][0-9,]*(?:\\.[0-9]{1,2})?)")
    private val MONEY_OUT = Regex("(?i)\\b(debited|spent|withdrawn|deducted|debit|paid|sent|purchase)\\b")
    private val MONEY_IN = Regex("(?i)\\b(credited|deposited|received|refunded|refund)\\b")
    private val NOT_DONE = Regex(
        "(?i)\\b(otp|one[\\s-]?time[\\s-]?password|verification code|will be (?:debited|credited)|is due|due (?:on|by|date)|" +
            "requested|failed|declined|unsuccessful|insufficient|pre-?approved|mandate|upcoming)\\b"
    )
    private val BALANCE_BEFORE = Regex("(?i)(bal(ance)?|avl|avail(able)?|limit|lmt|outstanding|due)[^0-9]{0,14}$")
    private val PHONE_NUMBER = Regex("^\\+?\\d{10,}$")

    /** "₹500 spent" / "₹2,000 received", or null when it doesn't look like a bank transaction. */
    fun headline(address: String, body: String): String? {
        if (PHONE_NUMBER.matches(address.replace(Regex("[\\s()-]"), ""))) return null
        if (address.trim().uppercase().endsWith("-P")) return null
        val text = body.replace(Regex("(?i)\\b(?:credit|debit)\\s*card"), "card").replace(Regex("\\s+"), " ")
        if (NOT_DONE.containsMatchIn(text)) return null
        val out = MONEY_OUT.find(text)?.range?.first
        val incoming = MONEY_IN.find(text)?.range?.first
        val spent = when {
            out == null && incoming == null -> return null
            out == null -> false
            incoming == null -> true
            else -> out <= incoming
        }
        var amount: String? = null
        for (m in AMOUNT.findAll(text)) {
            val before = text.substring(maxOf(0, m.range.first - 30), m.range.first)
            if (BALANCE_BEFORE.containsMatchIn(before)) continue
            amount = m.groupValues[1]
            break
        }
        val value = (amount ?: BARE_AMOUNT.find(text)?.groupValues?.get(1) ?: return null)
            .removeSuffix(".00").removeSuffix(".0")
        return if (spent) "₹$value spent" else "₹$value received"
    }

    fun notify(context: Context, title: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.sms_channel), NotificationManager.IMPORTANCE_DEFAULT)
        )
        val open = PendingIntent.getActivity(
            context, 2,
            Intent(Intent.ACTION_VIEW, Uri.parse("expenses://sms"), context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        // On the lock screen, show no amount
        val hidden = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("New bank transaction")
            .build()
        val notification = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText("Tap to add it in Expenses")
            .setContentIntent(open)
            .setAutoCancel(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPublicVersion(hidden)
            .build()
        manager.notify(NOTIFICATION_ID, notification)
    }

    fun clearNotification(context: Context) {
        context.getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION_ID)
    }

    fun onMessage(context: Context, address: String, body: String) {
        if (!isEnabled(context) || !wantsNotifications(context) || !isGranted(context)) return
        if (MainActivity.inForeground) return // the open app reads it itself
        val title = headline(address, body) ?: return
        notify(context, title)
    }
}

/** Android tells every app with RECEIVE_SMS about a new message; most are ignored straight away. */
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        try {
            val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
            if (parts.isEmpty()) return
            val address = parts[0].displayOriginatingAddress ?: parts[0].originatingAddress ?: ""
            val body = parts.joinToString("") { it.displayMessageBody ?: it.messageBody ?: "" }
            BankSms.onMessage(context, address, body)
        } catch (_: Exception) {
            // A message we can't read is simply not announced
        }
    }
}
