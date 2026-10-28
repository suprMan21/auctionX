import 'package:flutter/material.dart';

/// Text field with a visible label (not just a hint), so screen readers and
/// people zoomed in always know what the field is for.
class AuthTextField extends StatelessWidget {
  const AuthTextField({
    super.key,
    required this.controller,
    required this.label,
    this.obscureText = false,
    this.keyboardType = TextInputType.text,
    this.autofillHints,
    this.textInputAction,
    this.onSubmitted,
    this.suffixIcon,
    this.errorText,
    this.enabled = true,
  });

  final TextEditingController controller;
  final String label;
  final bool obscureText;
  final TextInputType keyboardType;
  final Iterable<String>? autofillHints;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onSubmitted;
  final Widget? suffixIcon;
  final String? errorText;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      obscureText: obscureText,
      keyboardType: keyboardType,
      autofillHints: autofillHints,
      textInputAction: textInputAction,
      onSubmitted: onSubmitted,
      enabled: enabled,
      autocorrect: false,
      enableSuggestions: !obscureText,
      style: const TextStyle(color: Colors.white),
      decoration: InputDecoration(
        labelText: label,
        suffixIcon: suffixIcon,
        errorText: errorText,
      ),
    );
  }
}
