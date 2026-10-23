import { Libre_Caslon_Display, Libre_Caslon_Text, Schibsted_Grotesk } from "next/font/google";

// Plate typography: Caslon for headings and Latin NAV names, as in the
// classic anatomy atlases; a sturdy grotesk for labels and UI.
const display = Libre_Caslon_Display({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
});
const heading = Libre_Caslon_Text({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-heading",
});
const sans = Schibsted_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const fontVariables = `${display.variable} ${heading.variable} ${sans.variable}`;
