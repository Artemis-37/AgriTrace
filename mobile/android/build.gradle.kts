allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}
// Certains plugins (sélecteur de fichiers, partage…) sont compilés contre une API Android plus ancienne que celle qu'exigent leurs dépendances
// (androidx lifecycle : API 36). On relève leur compileSdk à 36 s'il est plus bas ; l'application elle-même suit Flutter.
subprojects {
    if (project.name != "app") {
        afterEvaluate {
            val ext = project.extensions.findByName("android") ?: return@afterEvaluate
            try {
                val current = (ext.javaClass.getMethod("getCompileSdk").invoke(ext) as? Int) ?: 0
                if (current < 36) ext.javaClass.getMethod("setCompileSdk", Integer::class.javaObjectType).invoke(ext, 36)
            } catch (e: Exception) {
                logger.warn("compileSdk non relevé pour ${project.name} : ${e.message}")
            }
        }
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
