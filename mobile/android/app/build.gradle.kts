plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "ci.agritrace.agritrace_mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "ci.agritrace.agritrace_mobile"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // Signature de production : keystore fourni par l'environnement (ANDROID_KEYSTORE_FILE, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD).
    // Sans keystore, la compilation « release » est REFUSÉE, sauf si ALLOW_DEBUG_SIGNING=true (APK d'essai signé avec la clé de débogage : NE PAS distribuer).
    val ksFile = System.getenv("ANDROID_KEYSTORE_FILE")
    if (ksFile != null && file(ksFile).exists()) {
        signingConfigs {
            create("production") {
                storeFile = file(ksFile)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    gradle.taskGraph.whenReady {
        val release = allTasks.any { it.name.contains("Release", ignoreCase = true) && (it.name.startsWith("assemble") || it.name.startsWith("bundle") || it.name.startsWith("package")) }
        val signed = ksFile != null && file(ksFile).exists()
        if (release && !signed && System.getenv("ALLOW_DEBUG_SIGNING") != "true")
            throw GradleException("Compilation release refusée : aucune clé de signature (ANDROID_KEYSTORE_FILE). Pour un APK d'essai non distribuable : ALLOW_DEBUG_SIGNING=true.")
    }

    buildTypes {
        release {
            signingConfig = if (ksFile != null && file(ksFile).exists()) signingConfigs.getByName("production") else signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
