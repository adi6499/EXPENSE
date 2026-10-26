package com.adi6499.expenses

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.content.ContextCompat
import java.util.Calendar

/** The once-a-day "did you log today's spending?" notification. */
object Reminders {
    private const val PREFS = "reminder"
    private const val CHANNEL = "daily_reminder"
    private const val NOTIFICATION_ID = 1

    fun save(context: Context, enabled: Boolean, hour: Int, minute: Int) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean("enabled", enabled)
            .putInt("hour", hour.coerceIn(0, 23))
            .putInt("minute", minute.coerceIn(0, 59))
            .apply()
    }

    /** Sets (or clears) the alarm for the next reminder time. */
    fun schedule(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val alarms = context.getSystemService(AlarmManager::class.java) ?: return
        val pending = PendingIntent.getBroadcast(
            context, 0, Intent(context, ReminderReceiver::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        alarms.cancel(pending)
        if (!prefs.getBoolean("enabled", false)) return

        val next = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, prefs.getInt("hour", 21))
            set(Calendar.MINUTE, prefs.getInt("minute", 0))
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
            if (timeInMillis <= System.currentTimeMillis() + 60_000) add(Calendar.DAY_OF_YEAR, 1)
        }
        // A 10-minute window needs no special "exact alarm" permission and is easy on the battery
        alarms.setWindow(AlarmManager.RTC_WAKEUP, next.timeInMillis, 10 * 60_000L, pending)
    }

    fun show(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return

        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.reminder_channel), NotificationManager.IMPORTANCE_DEFAULT)
        )
        val open = PendingIntent.getActivity(
            context, 1,
            Intent(Intent.ACTION_VIEW, Uri.parse("expenses://add"), context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = android.app.Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Log today's spending")
            .setContentText("Tap to add anything you spent today.")
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        manager.notify(NOTIFICATION_ID, notification)
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Reminders.show(context)
        Reminders.schedule(context) // tomorrow
    }
}

/** Alarms are wiped when the phone restarts or the app updates, so set the reminder again. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Reminders.schedule(context)
    }
}
