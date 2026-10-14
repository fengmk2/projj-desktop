import { div, svg } from "gpui-kit";
import { h_flex, v_flex, Button, Input, Textarea } from "gpui-base";
/** @returns {import("gpui-kit").NativeElement} */
export const icon = (name, size = 18) =>
  svg(`projj/icons/${name}.svg`).size(size).flex_shrink_0();
/** @returns {import("gpui-kit").NativeElement} */
export const text = (label, size = 14, color) =>
  div()
    .text_size(size)
    .when(!!color, (el) => el.text_color(color))
    .child(String(label));
/** @returns {import("gpui-kit").NativeElement} */
export const muted = (label, cx, size = 12) =>
  text(label, size, cx.theme().colors.muted_foreground);
/** @returns {import("gpui-kit").NativeElement} */
export const row = () => h_flex().items_center().gap(10);
/** @param {{primary?: boolean, danger?: boolean, disabled?: boolean, icon?: string}} options
 * @returns {import("gpui-kit").NativeElement} */
export function button(id, label, cx, action, options = {}) {
  const c = cx.theme().colors;
  return Button.new(id)
    .accessibility_label(label || id)
    .h(34)
    .flex_shrink_0()
    .px(12)
    .rounded(7)
    .gap(7)
    .items_center()
    .justify_center()
    .text_size(12)
    .font_weight(500)
    .bg(
      options.primary
        ? c.primary
        : options.danger
          ? c.destructive
          : c.secondary,
    )
    .text_color(
      options.primary
        ? c.primary_foreground
        : options.danger
          ? c.destructive_foreground
          : c.foreground,
    )
    .disabled(!!options.disabled)
    .when(!!options.disabled, (el) => el.opacity(0.45))
    .hover((el) => el.opacity(0.8))
    .on_click((_, cx) => action(cx))
    .when(!!options.icon, (el) => el.child(icon(options.icon, 15)))
    .child(label);
}
/** @returns {import("gpui-kit").NativeElement} */
export const field = (state, cx) =>
  Input.new(state)
    .h(38)
    .flex_shrink_0()
    .px(11)
    .rounded(7)
    .border(1)
    .border_color(cx.theme().colors.border)
    .bg(cx.theme().colors.background)
    .text_size(13)
    .w_full();
/** @returns {import("gpui-kit").NativeElement} */
export const editor = (state, cx) =>
  Textarea.new(state)
    .w_full()
    .flex_1()
    .min_h(160)
    .p(12)
    .rounded(8)
    .border(1)
    .border_color(cx.theme().colors.border)
    .bg(cx.theme().colors.background)
    .text_size(13)
    .font_family("monospace");
/** @returns {import("gpui-kit").NativeElement} */
export const labelField = (label, state, cx, hint) =>
  v_flex()
    .flex_shrink_0()
    .gap(6)
    .child(text(label, 12, cx.theme().colors.foreground))
    .child(field(state, cx))
    .when(!!hint, (el) => el.child(muted(hint, cx)));
/** @returns {import("gpui-kit").NativeElement} */
export const badge = (label, cx, active = false) =>
  div()
    .px(8)
    .py(3)
    .rounded(5)
    .text_size(11)
    .bg(active ? cx.theme().colors.accent : cx.theme().colors.secondary)
    .text_color(
      active ? cx.theme().colors.primary : cx.theme().colors.muted_foreground,
    )
    .child(String(label));
