import Twitter from "@auth/core/providers/twitter";
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Twitter({
      // Default profile drops the handle; keep it for leaderboard display.
      profile(profile) {
        return {
          id: profile.data.id,
          name: profile.data.name,
          username: profile.data.username,
          image: profile.data.profile_image_url,
        };
      },
    }),
  ],
});
