import 'package:hive/hive.dart';

class PendingScan extends HiveObject {
  final String tagUid;
  final String piccData;
  final String cmac;
  final DateTime scannedAt;
  bool synced;

  PendingScan({
    required this.tagUid,
    required this.piccData,
    required this.cmac,
    required this.scannedAt,
    this.synced = false,
  });
}

class PendingScanAdapter extends TypeAdapter<PendingScan> {
  @override
  final int typeId = 0;

  @override
  PendingScan read(BinaryReader reader) {
    final numOfFields = reader.readByte();
    final fields = <int, dynamic>{
      for (int i = 0; i < numOfFields; i++) reader.readByte(): reader.read(),
    };
    return PendingScan(
      tagUid: fields[0] as String,
      piccData: fields[1] as String,
      cmac: fields[2] as String,
      scannedAt: fields[3] as DateTime,
      synced: fields[4] as bool? ?? false,
    );
  }

  @override
  void write(BinaryWriter writer, PendingScan obj) {
    writer
      ..writeByte(5) // number of fields
      ..writeByte(0)
      ..write(obj.tagUid)
      ..writeByte(1)
      ..write(obj.piccData)
      ..writeByte(2)
      ..write(obj.cmac)
      ..writeByte(3)
      ..write(obj.scannedAt)
      ..writeByte(4)
      ..write(obj.synced);
  }
}
