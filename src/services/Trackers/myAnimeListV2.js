import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import qs from 'qs';
import { createTracker } from './index';

const clientId = 'd2f499825d64b0213bb77e78193ccbb1';
const baseOAuthUrl = 'https://myanimelist.net/v1/oauth2/authorize';
const tokenUrl = 'https://myanimelist.net/v1/oauth2/token';
const baseApiUrl = 'https://api.myanimelist.net/v2';
const challenge = pkceChallenger();
const authUrl = `${baseOAuthUrl}?response_type=code&client_id=${clientId}&code_challenge_method=plain&code_challenge=${challenge}`;
const redirectUri = Linking.createURL();

export const myAnimeListTracker = createTracker('MyAnimeList', {
  authStrategy: {
    authenticator: async () => {
      const result = await WebBrowser.openAuthSessionAsync(
        authUrl,
        redirectUri,
      );

      if (result.type === 'success') {
        const { url } = result;

        const codeExtractor = new RegExp(/[=]([^&]+)/);
        let code = url.match(codeExtractor);

        if (code) {
          code = code[1];
          const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: qs.stringify({
              client_id: clientId,
              grant_type: 'authorization_code',
              code,
              code_verifier: challenge,
            }),
          });

          const tokenResponse = await response.json();
          return {
            accessToken: tokenResponse.access_token,
            refreshToken: tokenResponse.refresh_token,
            expiresAt: new Date(Date.now() + tokenResponse.expires_in),
          };
        }
      }
    },
    revalidator: async auth => {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: qs.stringify({
          grant_type: 'refresh_token',
          refresh_token: auth.refreshToken,
        }),
      });

      const tokenResponse = await response.json();
      return {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt: new Date(Date.now() + tokenResponse.expires_in),
      };
    },
  },
  searchHandler: async (search, auth) => {
    const searchUrl = `${baseApiUrl}/manga?q=${search}&fields=id,title,main_picture,media_type`;
    const response = await fetch(searchUrl, {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
      },
    });

    if (response.status !== 200) {
      return [];
    }

    const { data } = await response.json();
    return data
      .filter(e => e.node.media_type === 'light_novel')
      .map(e => {
        return {
          id: e.node.id,
          title: e.node.title,
          coverImage: e.node.main_picture.large,
        };
      });
  },
  listFinder: async (id, auth) => {
    const url = `${baseApiUrl}/manga/${id}?fields=id,num_chapters,my_list_status{start_date,finish_date}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
      },
    });

    const data = await response.json();
    return {
      status: data.my_list_status?.status || 'reading',
      score: data.my_list_status?.score || 0,
      progress: data.my_list_status?.num_chapters_read || 0,
      totalChapters: data.num_chapters,
    };
  },
  listUpdater: async (id, payload, auth) => {
    const url = `${baseApiUrl}/manga/${id}/my_list_status`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: qs.stringify({
        status: payload.status,
        num_chapters_read: payload.progress,
        score: payload.score,
      }),
    });

    const data = await res.json();
    return {
      status: data.status,
      progress: data.num_chapters_read,
      score: data.score,
    };
  },
});

function pkceChallenger() {
  const MAX_LENGTH = 88;
  let code = '';

  const codes =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  const randomPicker = () => Math.floor(Math.random() * codes.length);

  for (let index = 0; index < MAX_LENGTH; index++) {
    code += codes.charAt(randomPicker());
  }
  return code;
}
