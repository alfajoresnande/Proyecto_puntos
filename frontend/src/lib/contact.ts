export const WHATSAPP_NUMBER = "5493794632610";
export const WHATSAPP_DEFAULT_MESSAGE = "Hola, buenas te quiero consultar sobre ....";
export const COMPANY_EMAIL = "alfajorescorrentinosnande@gmail.com";
export const INSTAGRAM_HANDLE = "@alfajorescorrentinos";
export const INSTAGRAM_PROFILE_URL = "https://www.instagram.com/alfajorescorrentinos/";
export const COMPANY_PHONE_DISPLAY = "+54 3794 632610";
export const COMPANY_ADDRESS_LINES = [
  "La Unidad, Av. 3 de Abril 57",
  "Mercado de Sabores, Local 3,",
  "Corrientes, Argentina",
] as const;

export const WHATSAPP_COMPANY_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_DEFAULT_MESSAGE)}`;
