import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
}

// Release signing: reads keystore.properties at the project root when present
// (storeFile, storePassword, keyAlias, keyPassword). Falls back to the debug key
// so the project still builds on a machine without the keystore.
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) FileInputStream(keystorePropertiesFile).use { load(it) }
}
val hasReleaseKeystore = keystorePropertiesFile.exists() &&
    rootProject.file(keystoreProperties.getProperty("storeFile", "")).exists()

android {
    namespace = "com.adi6499.expenses"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.adi6499.expenses"
        minSdk = 26
        targetSdk = 35
        versionCode = 7
        versionName = "1.5.0"
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = if (hasReleaseKeystore) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.10.0")
    implementation("androidx.webkit:webkit:1.12.1")
    // Reads the text on a photographed shop bill, on the phone, free. Uses the reader inside Google Play
    // services (downloaded once, then offline) so the app stays small; the bundled one adds ~40 MB.
    implementation("com.google.android.gms:play-services-mlkit-text-recognition:19.0.1")
}
