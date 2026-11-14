package com.adi6499.expenses

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.util.Base64
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import org.json.JSONArray
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.Calendar

/** Bill reminders: the web app hands over a list of { id, title, text, at }; each becomes an alarm. */
object BillReminders {
    private const val PREFS = "bill_reminders"
    private const val CHANNEL = "bill_reminders"

    fun save(context: Context, json: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("list", json).apply()
    }

    private fun list(context: Context): JSONArray = try {
        JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("list", "[]"))
    } catch (_: Exception) {
        JSONArray()
    }

    private fun pendingFor(context: Context, id: String): PendingIntent = PendingIntent.getBroadcast(
        context, id.hashCode(),
        Intent(context, BillReminderReceiver::class.java).putExtra("id", id),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    /** Clears the old alarms and sets one per reminder that is still ahead. */
    fun schedule(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val alarms = context.getSystemService(AlarmManager::class.java) ?: return
        for (old in prefs.getStringSet("scheduled", emptySet()) ?: emptySet()) alarms.cancel(pendingFor(context, old))
        val scheduled = mutableSetOf<String>()
        val items = list(context)
        val now = System.currentTimeMillis()
        for (i in 0 until items.length()) {
            val item = items.optJSONObject(i) ?: continue
            val id = item.optString("id")
            val at = item.optLong("at")
            if (id.isEmpty() || at <= now) continue
            // A 15-minute window needs no "exact alarm" permission and is kind to the battery
            alarms.setWindow(AlarmManager.RTC_WAKEUP, at, 15 * 60_000L, pendingFor(context, id))
            scheduled += id
        }
        prefs.edit().putStringSet("scheduled", scheduled).apply()
    }

    fun show(context: Context, id: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val items = list(context)
        for (i in 0 until items.length()) {
            val item = items.optJSONObject(i) ?: continue
            if (item.optString("id") != id) continue
            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, context.getString(R.string.bills_channel), NotificationManager.IMPORTANCE_DEFAULT)
            )
            val open = PendingIntent.getActivity(
                context, 3,
                Intent(Intent.ACTION_VIEW, Uri.parse("expenses://bills"), context, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val notification = android.app.Notification.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(item.optString("title"))
                .setContentText(item.optString("text"))
                .setContentIntent(open)
                .setAutoCancel(true)
                .build()
            manager.notify(id.hashCode(), notification)
            return
        }
    }
}

class BillReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        BillReminders.show(context, intent.getStringExtra("id") ?: return)
    }
}

/** The home-screen widget. The web app sends the numbers whenever they change (see updateWidget). */
class ExpensesWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        for (id in ids) manager.updateAppWidget(id, views(context))
    }

    companion object {
        private const val PREFS = "widget"

        fun save(context: Context, today: String, month: String, line: String, zero: String) {
            val now = Calendar.getInstance()
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("today", today).putString("month", month).putString("line", line).putString("zero", zero)
                .putInt("day", now.get(Calendar.DAY_OF_YEAR) + now.get(Calendar.YEAR) * 1000)
                .putInt("monthKey", now.get(Calendar.MONTH) + now.get(Calendar.YEAR) * 100)
                .apply()
        }

        fun refresh(context: Context) {
            val manager = AppWidgetManager.getInstance(context) ?: return
            val ids = manager.getAppWidgetIds(ComponentName(context, ExpensesWidget::class.java))
            for (id in ids) manager.updateAppWidget(id, views(context))
        }

        private fun link(context: Context, code: Int, uri: String): PendingIntent = PendingIntent.getActivity(
            context, code,
            Intent(Intent.ACTION_VIEW, Uri.parse(uri), context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        private fun views(context: Context): RemoteViews {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val now = Calendar.getInstance()
            val sameDay = prefs.getInt("day", 0) == now.get(Calendar.DAY_OF_YEAR) + now.get(Calendar.YEAR) * 1000
            val sameMonth = prefs.getInt("monthKey", 0) == now.get(Calendar.MONTH) + now.get(Calendar.YEAR) * 100
            val zero = prefs.getString("zero", "₹0") ?: "₹0"
            // Nothing can be added while the app is closed, so a new day (or month) starts at zero
            val today = if (sameDay) prefs.getString("today", zero) else zero
            val month = if (sameMonth) prefs.getString("month", zero) else zero
            val line = if (sameMonth) prefs.getString("line", "") else ""
            return RemoteViews(context.packageName, R.layout.widget).apply {
                setTextViewText(R.id.widget_today, today)
                setTextViewText(R.id.widget_month, "This month $month")
                setTextViewText(R.id.widget_line, line)
                setOnClickPendingIntent(R.id.widget_root, link(context, 10, "expenses://home"))
                setOnClickPendingIntent(R.id.widget_add, link(context, 11, "expenses://add"))
                setOnClickPendingIntent(R.id.widget_speak, link(context, 12, "expenses://speak"))
            }
        }
    }
}

/** Bill photos: one JPEG per transaction in the app's private storage, shown at /photos/<id>.jpg. */
object Photos {
    fun dir(context: Context): File = File(context.filesDir, "photos").apply { mkdirs() }

    private fun safe(id: String) = id.replace(Regex("[^A-Za-z0-9_-]"), "_")

    fun save(context: Context, id: String, base64: String): Boolean = try {
        File(dir(context), "${safe(id)}.jpg").writeBytes(Base64.decode(base64, Base64.DEFAULT))
        true
    } catch (_: Exception) {
        false
    }

    fun delete(context: Context, id: String) {
        File(dir(context), "${safe(id)}.jpg").delete()
    }

    /** Deletes photos whose transaction no longer exists. */
    fun clean(context: Context, keepJson: String) {
        val keep = try {
            val array = JSONArray(keepJson)
            (0 until array.length()).map { "${safe(array.getString(it))}.jpg" }.toSet()
        } catch (_: Exception) {
            return
        }
        dir(context).listFiles()?.forEach { if (it.name !in keep) it.delete() }
    }

    /** Reads a picked picture, turns it the right way up and shrinks it (longest side 1600 px) to a JPEG data URL. */
    fun loadScaled(context: Context, uri: Uri): String {
        val resolver = context.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 1600) sample *= 2
        var bitmap = resolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: error("Couldn't open that picture")
        val rotation = try {
            resolver.openInputStream(uri)?.use {
                when (ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                    ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                    ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                    ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                    else -> 0f
                }
            } ?: 0f
        } catch (_: Exception) {
            0f
        }
        val scale = minOf(1f, 1600f / maxOf(bitmap.width, bitmap.height))
        if (rotation != 0f || scale < 1f) {
            val matrix = Matrix().apply { postScale(scale, scale); postRotate(rotation) }
            bitmap = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        }
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 78, out)
        return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }
}
