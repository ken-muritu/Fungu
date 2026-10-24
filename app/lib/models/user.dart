class FunguUser {
  final String id;
  final String phone;
  final String name;

  FunguUser({required this.id, required this.phone, required this.name});

  factory FunguUser.fromJson(Map<String, dynamic> json) {
    return FunguUser(id: json['id'], phone: json['phone'], name: json['name']);
  }
}
