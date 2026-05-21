import { Composition } from 'remotion';
import { ParaEsoTrabajoVideo } from './ParaEsoTrabajoVideo';
import dealData from './deal_data.json';

export const RemotionRoot: React.FC = () => {
  // Calculamos la duración exacta sumando todos los frames de las escenas
  const totalFrames = dealData.scenes.reduce((acc: number, scene: any) => acc + scene.durationInFrames, 0);

  return (
    <>
      <Composition
        id="ParaEsoTrabajoVideo"
        component={ParaEsoTrabajoVideo}
        durationInFrames={totalFrames}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
};
