import React, { forwardRef, useEffect, useImperativeHandle } from 'react';
import {
  Dimensions,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';

import Animated, {
  useSharedValue,
  useWorkletCallback,
} from 'react-native-reanimated';

import {
  DEFAULT_BRUSH_COLOR,
  DEFAULT_ERASER_SIZE,
  DEFAULT_OPACITY,
  DEFAULT_THICKNESS,
  DEFAULT_TOOL,
} from './constants';
import { DrawingTool, PathDataType, PathType } from './types';
import { createSVGPath } from './utils';
import SVGRenderer from './renderer/SVGRenderer';
import RendererHelper from './renderer/RendererHelper';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

export interface CanvasProps {
  /**
   * Color of the brush strokes
   * @default DEFAULT_BRUSH_COLOR
   */
  color?: string;

  /**
   * Thickness of the brush strokes
   * @default DEFAULT_THICKNESS
   */
  thickness?: number;

  /**
   * Opacity of the brush strokes
   * @default DEFAULT_OPACITY
   */
  opacity?: number;

  /**
   * Paths to be already drawn
   * @default []
   */
  initialPaths?: PathType[];

  /**
   * Height of the canvas
   */
  height?: number;

  /**
   * Width of the canvas
   */
  width?: number;

  /**
   * Override the style of the container of the canvas
   */
  style?: StyleProp<ViewStyle>;

  /**
   * Callback function when paths change
   */
  onPathsChange?: (paths: PathType[]) => any;

  /**
   * SVG simplification options
   */
  simplifyOptions?: SimplifyOptions;

  /**
   * Width of eraser (to compensate for path simplification)
   * @default DEFAULT_ERASER_SIZE
   */
  eraserSize?: number;

  /**
   * Initial tool of the canvas
   * @default DEFAULT_TOOL
   */
  tool?: DrawingTool;

  /**
   * Combine current path with the last path if it's the same color,
   * thickness, and opacity.
   *
   * **Note**: changing this value while drawing will only be effective
   * on the next change to opacity, thickness, or color change
   * @default false
   */
  combineWithLatestPath?: boolean;

  /**
   * Allows for the canvas to be drawn on, put to false if you want to disable/lock
   * the canvas
   * @default true
   */
  enabled?: boolean;
}

export interface SimplifyOptions {
  /**
   * Enable SVG path simplification on paths, except the one currently being drawn
   */
  simplifyPaths?: boolean;

  /**
   * Enable SVG path simplification on the stroke being drawn
   */
  simplifyCurrentPath?: boolean;

  /**
   * Amount of simplification to apply
   */
  amount?: number;

  /**
   * Ignore fractional part in the points. Improves performance
   */
  roundPoints?: boolean;
}

export interface CanvasRef {
  /**
   * Undo last brush stroke
   */
  undo: () => void;

  /**
   * Removes all brush strokes
   */
  clear: () => void;

  /**
   * Get brush strokes data
   */
  getPaths: () => PathType[];

  /**
   * Append a path to the current drawing paths
   * @param path Path to append/draw
   */
  addPath: (path: PathType) => void;

  /**
   * Get SVG path string of the drawing
   */
  getSvg: () => string;
}

/**
 * Generate SVG path string. Helper method for createSVGPath
 *
 * @param paths SVG path data
 * @param simplifyOptions Simplification options for the SVG drawing simplification
 * @returns SVG path strings
 */
const generateSVGPath = (
  path: PathDataType,
  simplifyOptions: SimplifyOptions
) =>
  createSVGPath(
    path,
    simplifyOptions.simplifyPaths ? simplifyOptions.amount! : 0,
    simplifyOptions.roundPoints!
  );

/**
 * Generate multiple SVG path strings. If the path string is already defined, do not create a new one.
 *
 * @param paths SVG data paths
 * @param simplifyOptions Simplification options for the SVG drawing simplification
 * @returns An array of SVG path strings
 */
const generateSVGPaths = (
  paths: PathType[],
  simplifyOptions: SimplifyOptions
) =>
  paths.map((i) => ({
    ...i,
    path: i.path
      ? i.path
      : i.data.reduce(
          (acc: string[], data) => [
            ...acc,
            generateSVGPath(data, simplifyOptions),
          ],
          []
        ),
  }));

const Canvas = forwardRef<CanvasRef, CanvasProps>(
  (
    {
      color = DEFAULT_BRUSH_COLOR,
      thickness = DEFAULT_THICKNESS,
      opacity = DEFAULT_OPACITY,
      initialPaths = [],
      style,
      height = screenHeight - 80,
      width = screenWidth,
      simplifyOptions = {},
      onPathsChange,
      eraserSize = DEFAULT_ERASER_SIZE,
      tool = DEFAULT_TOOL,
      combineWithLatestPath = false,
      enabled = true,
    },
    ref
  ) => {
    simplifyOptions = {
      simplifyPaths: true,
      simplifyCurrentPath: false,
      amount: 15,
      roundPoints: true,
      ...simplifyOptions,
    };

    const paths = useSharedValue<PathType[]>(
      generateSVGPaths(initialPaths, simplifyOptions)
    );
    const path = useSharedValue<PathDataType>([]);

    const canvasContainerStyles = [
      styles.canvas,
      {
        height,
        width,
      },
      style,
    ];

    const addPointToPath = (x: number, y: number) => {
      path.value = [
        ...path.value,
        [
          simplifyOptions.roundPoints ? Math.floor(x) : x,
          simplifyOptions.roundPoints ? Math.floor(y) : y,
        ],
      ];
    };

    const undo = () => {
      paths.value = paths.value.reduce((acc: PathType[], p, index) => {
        if (index === paths.value.length - 1) {
          if (p.data.length > 1) {
            return [
              ...acc,
              {
                ...p,
                data: p.data.slice(0, -1),
                path: p.path!.slice(0, -1),
              },
            ];
          }
          return acc;
        }
        return [...acc, p];
      }, []);
    };

    const clear = () => {
      paths.value = [];
      path.value = [];
    };

    const getPaths = () => paths.value;

    const addPath = (newPath: PathType) =>
      (paths.value = [...paths.value, newPath]);

    const getSvg = () => {
      const serializePath = (
        d: string,
        stroke: string,
        strokeWidth: number,
        strokeOpacity: number
      ) =>
        `<path d="${d}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${strokeOpacity}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;

      const separatePaths = (p: PathType) =>
        p.path!.reduce(
          (acc, innerPath) =>
            `${acc}${serializePath(
              innerPath,
              p.color,
              p.thickness,
              p.opacity
            )}`,
          ''
        );

      const combinedPath = (p: PathType) =>
        `${serializePath(p.path!.join(' '), p.color, p.thickness, p.opacity)}`;

      const serializedPaths = paths.value.reduce(
        (acc, p) => `${acc}${p.combine ? combinedPath(p) : separatePaths(p)}`,
        ''
      );

      return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${serializedPaths}</svg>`;
    };

    useImperativeHandle(ref, () => ({
      undo,
      clear,
      getPaths,
      addPath,
      getSvg,
    }));

    useEffect(() => {
      onPathsChange && onPathsChange(paths.value);
    }, [paths, onPathsChange]);

    const onChange = ({ x, y }: { x: number; y: number }) => {
      switch (tool) {
        case DrawingTool.Brush:
          addPointToPath(x, y);
          break;
        case DrawingTool.Eraser:
          paths.value = paths.value.reduce((acc: PathType[], p) => {
            const filteredDataPaths = p.data.reduce(
              (acc2: { data: PathDataType[]; path: string[] }, data, index) => {
                const closeToPath = data.some(
                  ([x1, y1]) =>
                    Math.abs(x1 - x) < p.thickness + eraserSize &&
                    Math.abs(y1 - y) < p.thickness + eraserSize
                );

                // If point close to path, don't include it
                if (closeToPath) {
                  return acc2;
                }

                return {
                  data: [...acc2.data, data],
                  path: [...acc2.path, p.path![index]],
                };
              },
              { data: [], path: [] }
            );

            if (filteredDataPaths.data.length > 0) {
              return [...acc, { ...p, ...filteredDataPaths }];
            }

            return acc;
          }, []);
          break;
      }
    };

    const onBegin = ({ x, y }: { x: number; y: number }) => {
      if (tool === DrawingTool.Brush) {
        addPointToPath(x, y);
      }
    };

    const onEnd = () => {
      if (tool === DrawingTool.Brush) {
        const newSVGPath = generateSVGPath(path.value, simplifyOptions);

        if (paths.value.length === 0) {
          paths.value = [
            {
              color,
              path: [newSVGPath],
              data: [path.value],
              thickness,
              opacity,
              combine: combineWithLatestPath,
            },
          ];
        }

        const lastPath = paths.value[paths.value.length - 1];

        // Check if the last path has the same properties
        if (
          lastPath?.color === color &&
          lastPath?.thickness === thickness &&
          lastPath?.opacity === opacity
        ) {
          const newLastPath = {
            ...lastPath,
            path: [...lastPath.path!, newSVGPath],
            data: [...lastPath.data, path.value],
          };

          paths.value = [...paths.value.slice(0, -1), newLastPath];
        }

        paths.value = [
          ...paths.value,
          {
            color,
            path: [newSVGPath],
            data: [path.value],
            thickness,
            opacity,
            combine: combineWithLatestPath,
          },
        ];
        path.value = [];
      }
    };

    const panGesture = Gesture.Pan()
      .onChange(useWorkletCallback(onChange))
      .onBegin(useWorkletCallback(onBegin))
      .onEnd(useWorkletCallback(onEnd))
      .minPointers(1)
      .minDistance(0)
      .averageTouches(false)
      .hitSlop({
        height,
        width,
        top: 0,
        left: 0,
      })
      .shouldCancelWhenOutside(true)
      .enabled(enabled);

    return (
      <GestureHandlerRootView style={canvasContainerStyles}>
        <Animated.View>
          <GestureDetector gesture={panGesture}>
            <View>
              <RendererHelper
                currentColor={color}
                currentOpacity={opacity}
                currentPath={path.value}
                currentThickness={thickness}
                currentPathTolerance={
                  simplifyOptions.simplifyCurrentPath
                    ? simplifyOptions.amount!
                    : 0
                }
                roundPoints={simplifyOptions.roundPoints!}
                paths={paths.value}
                height={height}
                width={width}
                Renderer={SVGRenderer}
              />
            </View>
          </GestureDetector>
        </Animated.View>
      </GestureHandlerRootView>
    );
  }
);

const styles = StyleSheet.create({
  canvas: {
    backgroundColor: 'white',
  },
  canvasOverlay: {
    position: 'absolute',
    height: '100%',
    width: '100%',
    backgroundColor: '#000000',
  },
});

export default Canvas;
