import axios from "axios";

export async function getCollabToken(
  baseUrl: string,
  apiToken: string,
): Promise<string> {
  try {
    const response = await axios.post(
      `${baseUrl}/auth/collab-token`,
      {},
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    // console.error('Collab Token Response:', response.data);
    // Response is wrapped in { data: { token: ... } }
    return response.data.data?.token || response.data.token;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        `Failed to get collab token: ${error.response?.status} ${error.response?.statusText} - ${JSON.stringify(error.response?.data)}`,
      );
    }
    throw error;
  }
}

export async function performLogin(
  baseUrl: string,
  email: string,
  password: string,
): Promise<string> {
  try {
    const response = await axios.post(`${baseUrl}/auth/login`, {
      email,
      password,
    });

    // Extract token from Set-Cookie header
    const cookies = response.headers["set-cookie"];
    if (!cookies) {
      throw new Error("No Set-Cookie header found in login response");
    }
    const authCookie = cookies.find((c: string) => c.startsWith("authToken="));
    if (!authCookie) {
      throw new Error("No authToken cookie found in login response");
    }

    const token = authCookie.split(";")[0].split("=")[1];
    return token;
  } catch (error: any) {
    console.error(
      "Login failed:",
      axios.isAxiosError(error) ? error.response?.data : error.message,
    );
    throw error;
  }
}
