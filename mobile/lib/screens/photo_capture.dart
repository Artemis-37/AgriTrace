import 'package:image_picker/image_picker.dart';

/// Prend une photo avec l'appareil (réduite à 1 600 px pour tenir sur une connexion faible). Renvoie null si annulée ou indisponible.
Future<String?> takePhotoPath() async {
  try {
    final x = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 1600, imageQuality: 70);
    return x?.path;
  } catch (_) {
    return null;
  }
}
