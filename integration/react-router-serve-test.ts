import { test, expect } from "@playwright/test";

import { PlaywrightFixture } from "./helpers/playwright-fixture.js";
import type { Fixture, AppFixture } from "./helpers/create-fixture.js";
import {
  createAppFixture,
  createFixture,
  js,
} from "./helpers/create-fixture.js";
import { reactRouterConfig, type TemplateName } from "./helpers/vite.js";

const templateNames = [
  "vite-7-template",
  "rsc-vite-framework",
] as const satisfies TemplateName[];

test.describe("react-router-serve", () => {
  for (const templateName of templateNames) {
    test.describe(`template: ${templateName}`, () => {
      let fixture: Fixture;
      let appFixture: AppFixture;

      test.beforeEach(async ({ context }) => {
        await context.route(/\.(data|rsc)$/, async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          route.continue();
        });
      });

      test.beforeAll(async () => {
        fixture = await createFixture({
          templateName,
          useReactRouterServe: true,
          files: {
            "app/routes/_index.tsx": js`
              import { useLoaderData, Link } from "react-router";

              export function loader() {
                return "pizza";
              }

              export default function Index() {
                let data = useLoaderData();
                return (
                  <div>
                    {data}
                    <Link to="/burgers">Other Route</Link>
                  </div>
                )
              }
            `,

            "app/routes/burgers.tsx": js`
              export default function Index() {
                return <div>cheeseburger</div>;
              }
            `,
          },
        });

        // This creates an interactive app using playwright.
        appFixture = await createAppFixture(fixture);
      });

      test.afterAll(() => {
        appFixture.close();
      });

      test("should start and perform client side navigation", async ({
        page,
      }) => {
        let app = new PlaywrightFixture(appFixture, page);
        // You can test any request your app might get using `fixture`.
        let response = await fixture.requestDocument("/");
        expect(await response.text()).toMatch("pizza");

        // If you need to test interactivity use the `app`
        await app.goto("/");
        await app.clickLink("/burgers");
        await page.waitForSelector("text=cheeseburger");
      });
    });
  }

  test.describe("API-only mode", () => {
    let fixture: Fixture;
    let appFixture: AppFixture;

    test.beforeAll(async () => {
      fixture = await createFixture({
        useReactRouterServe: true,
        files: {
          "react-router.config.ts": reactRouterConfig({
            ssr: "unstable_api-only",
          }),
          "app/routes/api.tsx": js`
            export function loader() {
              return { message: "api-only-loader" };
            }
          `,
        },
      });
      appFixture = await createAppFixture(fixture);
    });

    test.afterAll(() => {
      appFixture.close();
    });

    test("serves the SPA fallback and forwards data requests", async () => {
      let documentResponse = await fetch(`${appFixture.serverUrl}/`);
      expect(documentResponse.status).toBe(200);
      let document = await documentResponse.text();
      expect(document).toContain("window.__reactRouterContext");

      let fallbackResponse = await fetch(
        `${appFixture.serverUrl}/does-not-exist`,
      );
      expect(fallbackResponse.status).toBe(200);
      expect(await fallbackResponse.text()).toBe(document);

      let dataResponse = await fetch(`${appFixture.serverUrl}/api.data`);
      expect(dataResponse.status).toBe(200);
      expect(await dataResponse.text()).toContain("api-only-loader");
    });
  });

  test.describe("well-known URIs", () => {
    for (const templateName of templateNames) {
      test.describe(`template: ${templateName}`, () => {
        let fixture: Fixture;
        let appFixture: AppFixture;

        test.beforeAll(async () => {
          fixture = await createFixture({
            templateName,
            useReactRouterServe: true,
            files: {
              "public/.well-known/security.txt":
                "Contact: mailto:security@example.com",
              "public/.hidden.txt": "should not be served",
              // Handle requests that fall through static serving without logging
              // an expected unmatched-route error from the default boundary.
              "app/routes/$.tsx": js`
                export function loader() {
                  return new Response("Not Found", { status: 404 });
                }
              `,
            },
          });
          appFixture = await createAppFixture(fixture);
        });

        test.afterAll(() => {
          appFixture.close();
        });

        test("serves files under /.well-known", async () => {
          let response = await fetch(
            `${appFixture.serverUrl}/.well-known/security.txt`,
          );
          expect(response.status).toBe(200);
          expect(await response.text()).toContain(
            "Contact: mailto:security@example.com",
          );
        });

        test("keeps other dotfiles hidden", async () => {
          let response = await fetch(`${appFixture.serverUrl}/.hidden.txt`);
          expect(response.status).toBe(404);
          expect(await response.text()).not.toContain("should not be served");
        });
      });
    }
  });
  test.describe("TRUST_PROXY", () => {
    for (const templateName of templateNames) {
      test.describe(`template: ${templateName}`, () => {
        let fixture: Fixture;

        test.beforeAll(async () => {
          fixture = await createFixture({
            templateName,
            useReactRouterServe: true,
            files: {
              "app/routes/_index.tsx": js`
                import { useLoaderData } from "react-router";

                export function loader({ request }) {
                  return new URL(request.url).origin;
                }

                export function action() {
                  return null;
                }

                export default function Index() {
                  return <p>{"origin=" + useLoaderData()}</p>;
                }
              `,
            },
          });
        });

        // A proxy that terminates TLS forwards plain HTTP and reports the scheme
        let behindProxy = (appFixture: AppFixture, method = "GET") =>
          fetch(`${appFixture.serverUrl}/?index`, {
            method,
            headers: {
              Origin: appFixture.serverUrl.replace("http:", "https:"),
              "X-Forwarded-Proto": "https",
            },
          });

        test("uses the forwarded protocol when the proxy is trusted", async () => {
          let appFixture = await createAppFixture({
            ...fixture,
            reactRouterServeEnv: { TRUST_PROXY: "1" },
          });
          try {
            let document = await behindProxy(appFixture);
            expect(await document.text()).toContain(
              `origin=${appFixture.serverUrl.replace("http:", "https:")}</p>`,
            );
            expect((await behindProxy(appFixture, "POST")).status).toBe(200);
          } finally {
            appFixture.close();
          }
        });

        test("ignores forwarded headers by default", async () => {
          let appFixture = await createAppFixture({
            ...fixture,
            reactRouterServeEnv: { TRUST_PROXY: "" },
          });
          try {
            let document = await behindProxy(appFixture);
            expect(await document.text()).toContain(
              `origin=${appFixture.serverUrl}</p>`,
            );
            expect((await behindProxy(appFixture, "POST")).status).toBe(400);
          } finally {
            appFixture.close();
          }
        });
      });
    }
  });
});
