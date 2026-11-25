package ci.agritrace.agritrace_mobile

import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.io.IOException

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // Enregistre un fichier dans le dossier Téléchargements du téléphone (comme un téléchargement du navigateur).
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "ci.agritrace/downloads").setMethodCallHandler { call, result ->
            if (call.method != "save") { result.notImplemented(); return@setMethodCallHandler }
            try {
                val name = call.argument<String>("name") ?: throw IOException("nom manquant")
                val mime = call.argument<String>("mime") ?: "application/octet-stream"
                val bytes = call.argument<ByteArray>("bytes") ?: throw IOException("contenu manquant")
                result.success(saveToDownloads(name, mime, bytes))
            } catch (e: Exception) {
                result.error("save_failed", e.message, null)
            }
        }
    }

    private fun saveToDownloads(name: String, mime: String, bytes: ByteArray): String {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, mime)
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: throw IOException("Téléchargements inaccessible")
            contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: throw IOException("écriture impossible")
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            contentResolver.update(uri, values, null, null)
            // Nom réellement donné par Android (il ajoute « (1) » si un fichier de même nom existe).
            contentResolver.query(uri, arrayOf(MediaStore.Downloads.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) return c.getString(0)
            }
            return name
        }
        val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        dir.mkdirs()
        var f = File(dir, name)
        var i = 1
        val dot = name.lastIndexOf('.')
        while (f.exists()) { f = File(dir, if (dot > 0) "${name.substring(0, dot)} ($i)${name.substring(dot)}" else "$name ($i)"); i++ }
        f.writeBytes(bytes)
        return f.name
    }
}
