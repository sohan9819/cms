import {
  getAllCoursesAndContentHierarchy,
  getAllVideos,
  getVideoProgressForUser,
} from '@/db/course';
import { Cache } from '@/db/Cache';
import { authOptions } from '@/lib/auth';
import { Course } from '@/store/atoms';
import { getServerSession } from 'next-auth';

const APPX_AUTH_KEY = process.env.APPX_AUTH_KEY;
const APPX_CLIENT_SERVICE = process.env.APPX_CLIENT_SERVICE;
const APPX_BASE_API = process.env.APPX_BASE_API;
const LOCAL_CMS_PROVIDER = process.env.LOCAL_CMS_PROVIDER;

export async function getPurchases(email: string) {
  const _courses = await getAllCoursesAndContentHierarchy();
  const session = await getServerSession(authOptions);
  const userVideoProgress = await getVideoProgressForUser(
    session?.user?.id || '',
    true,
  );
  const allVideos = await getAllVideos();

  const completedVideosLookup: { [key: string]: boolean } =
    userVideoProgress?.reduce((acc: any, progress) => {
      acc[progress.contentId] = true;
      return acc;
    }, {});

  const courses = _courses.map((course) => {
    let totalVideos = 0;
    let totalVideosWatched = 0;
    course.content.forEach(({ contentId }) => {
      allVideos.forEach(({ parentId, id }) => {
        if (parentId === contentId) {
          totalVideos++;
          if (completedVideosLookup[id]) {
            totalVideosWatched++;
          }
        }
      });
    });

    return {
      id: course.id,
      title: course.title,
      imageUrl: course.imageUrl,
      description: course.description,
      appxCourseId: course.appxCourseId,
      openToEveryone: course.openToEveryone,
      slug: course.slug,
      discordRoleId: course.discordRoleId,
      ...(totalVideos > 0 && { totalVideos, totalVideosWatched }),
    };
  });

  if (LOCAL_CMS_PROVIDER) {
    return courses;
  }

  const baseUrl = `${APPX_BASE_API}/get/checkemailforpurchase`;


  const headers = {
    'Client-Service': APPX_CLIENT_SERVICE,
    'Auth-Key': APPX_AUTH_KEY,
  };

  const responses: Course[] = [];
  const cacheKey = `getAllEnrolledCourses-${email}`;
  

  // Check cache for pre-existing data
  const cachedValue = await Cache.getInstance().get(cacheKey, []);
  if (cachedValue.length > 0) {
    return cachedValue;
  }

  const promises = courses.map(async (course) => {
    const params = new URLSearchParams({
      email,
      itemtype: '10',
      itemid: course.appxCourseId.toString(),
    });
    //@ts-ignore
    const url = `${baseUrl}?${params}`;
    const response = await fetch(url, { headers });
    const data = await response.json();

    if (data.data === '1') {
      responses.push(course);
    }
  });

  await Promise.all(promises);

  if (responses.length) {
    for (const course of courses) {
      if (course.openToEveryone) {
        responses.push(course);
      }
    }
  }

  // Cache the fetched data for future use
  Cache.getInstance().set(cacheKey, [], responses , 86400);

  return responses;
}
