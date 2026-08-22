const { AndroidConfig, withAndroidColors, withAndroidColorsNight } = require('expo/config-plugins');

const colors = {
  background: ['#FBFBFD', '#111215'], surface: ['#FFFFFF', '#191A1F'],
  surface_subtle: ['#F4F5F7', '#1B1C21'], text_primary: ['#0C0D10', '#F4F4F5'],
  text_secondary: ['#5A5F6A', '#B6B8C0'], text_faint: ['#9CA3AF', '#787B85'],
  border: ['#EDEEF0', '#2A2C32'], border_strong: ['#E3E5E9', '#373941'],
  accent: ['#047857', '#34D399'], accent_surface: ['#ECFDF5', '#123D32'],
  cta_background: ['#2B2A2A', '#F4F4F5'], cta_text: ['#FFFFFF', '#17181C'],
  danger: ['#B42318', '#FF8A82'], danger_surface: ['#FEF3F2', '#4A2020'],
  danger_border: ['#FECDCA', '#773434'], warning: ['#B45309', '#F6C665'],
  warning_surface: ['#FFFBEB', '#423515'], warning_border: ['#FDE68A', '#705A20'],
  info: ['#2563EB', '#8AB4FF'], info_surface: ['#EFF6FF', '#1C3457'],
};

function setColors(config, modifier, index) {
  return modifier(config, (nextConfig) => {
    for (const [name, values] of Object.entries(colors)) {
      AndroidConfig.Colors.setColorItem({ $: { name: `parse_${name}` }, _: values[index] }, nextConfig.modResults);
    }
    return nextConfig;
  });
}

module.exports = function withDarkThemeColors(config) {
  return setColors(setColors(config, withAndroidColors, 0), withAndroidColorsNight, 1);
};
