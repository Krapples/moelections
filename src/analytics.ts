export {};

type GoatCounterSettings = {
  path: string;
  title: string;
  referrer: string;
};

declare global {
  interface Window {
    goatcounter?: GoatCounterSettings;
  }
}

(() => {
  // Set this to the public GoatCounter site code or its HTTPS /count URL.
  // Leave it empty to keep analytics disabled.
  const siteCodeOrCountUrl = "https://krapples.goatcounter.com/count";

  if (!siteCodeOrCountUrl || window.location.hostname !== "krapples.github.io") return;
  const endpoint = /^[a-z0-9-]+$/.test(siteCodeOrCountUrl)
    ? `https://${siteCodeOrCountUrl}.goatcounter.com/count`
    : /^https:\/\/[a-z0-9-]+\.goatcounter\.com\/count$/.test(siteCodeOrCountUrl)
      ? siteCodeOrCountUrl
      : "";
  if (!endpoint) return;

  // Do not send query strings or referrer URLs to the analytics service.
  window.goatcounter = {
    path: window.location.pathname,
    title: "",
    referrer: "",
  };

  const script = document.createElement("script");
  script.async = true;
  script.referrerPolicy = "no-referrer";
  script.src = "https://gc.zgo.at/count.js";
  script.dataset.goatcounter = endpoint;
  document.head.append(script);
})();
